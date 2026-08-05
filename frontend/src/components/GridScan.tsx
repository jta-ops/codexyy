import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { BloomEffect, ChromaticAberrationEffect, EffectComposer, EffectPass, RenderPass } from 'postprocessing'
import './GridScan.css'

const vert = `
varying vec2 vUv;
void main(){
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

const frag = `
precision highp float;
uniform vec3 iResolution;
uniform float iTime;
uniform vec2 uSkew;
uniform float uTilt;
uniform float uYaw;
uniform float uLineThickness;
uniform vec3 uLinesColor;
uniform vec3 uScanColor;
uniform float uGridScale;
uniform float uScanOpacity;
uniform float uScanDirection;
uniform float uNoise;
uniform float uBloomOpacity;
uniform float uScanGlow;
uniform float uScanSoftness;
uniform float uPhaseTaper;
uniform float uScanDuration;
uniform float uScanDelay;
varying vec2 vUv;

float smoother01(float a,float b,float x){
  float t=clamp((x-a)/max(1e-5,(b-a)),0.0,1.0);
  return t*t*t*(t*(t*6.0-15.0)+10.0);
}

void mainImage(out vec4 fragColor,in vec2 fragCoord){
  vec2 p=(2.0*fragCoord-iResolution.xy)/iResolution.y;
  vec3 ro=vec3(0.0);
  vec3 rd=normalize(vec3(p,2.0));
  float cR=cos(uTilt),sR=sin(uTilt);
  rd.xy=mat2(cR,-sR,sR,cR)*rd.xy;
  float cY=cos(uYaw),sY=sin(uYaw);
  rd.xz=mat2(cY,-sY,sY,cY)*rd.xz;
  vec2 skew=clamp(uSkew,vec2(-0.7),vec2(0.7));
  rd.xy+=skew*rd.z;
  vec3 color=vec3(0.0);
  float minT=1e20;
  float gridScale=max(1e-5,uGridScale);
  float fadeStrength=2.0;
  vec2 gridUV=vec2(0.0);
  float hitIsY=1.0;
  for(int i=0;i<4;i++){
    float isY=float(i<2);
    float pos=mix(-0.2,0.2,float(i))*isY+mix(-0.5,0.5,float(i-2))*(1.0-isY);
    float num=pos-(isY*ro.y+(1.0-isY)*ro.x);
    float den=isY*rd.y+(1.0-isY)*rd.x;
    float t=num/den;
    vec3 h=ro+rd*t;
    bool use=t>0.0&&t<minT;
    gridUV=use?mix(h.zy,h.xz,isY)/gridScale:gridUV;
    minT=use?t:minT;
    hitIsY=use?isY:hitIsY;
  }
  vec3 hit=ro+rd*minT;
  float dist=length(hit-ro);
  float fx=fract(gridUV.x);float fy=fract(gridUV.y);
  float ax=min(fx,1.0-fx);float ay=min(fy,1.0-fy);
  float wx=fwidth(gridUV.x);float wy=fwidth(gridUV.y);
  float halfPx=max(0.0,uLineThickness)*0.5;
  float tx=halfPx*wx;float ty=halfPx*wy;
  float lineX=1.0-smoothstep(tx,tx+wx,ax);
  float lineY=1.0-smoothstep(ty,ty+wy,ay);
  float lineMask=max(lineX,lineY);
  float fade=exp(-dist*fadeStrength);
  float dur=max(0.05,uScanDuration);
  float del=max(0.0,uScanDelay);
  float scanZMax=2.0;
  float sigma=max(0.001,0.18*max(0.1,uScanGlow)*uScanSoftness);
  float sigmaA=sigma*2.0;
  float cycle=dur+del;
  float tCycle=mod(iTime,cycle);
  float scanPhase=clamp((tCycle-del)/dur,0.0,1.0);
  float phase=scanPhase;
  if(uScanDirection>1.5){
    float t2=mod(max(0.0,iTime-del),2.0*dur);
    phase=(t2<dur)?(t2/dur):(1.0-(t2-dur)/dur);
  }
  float scanZ=phase*scanZMax;
  float dz=abs(hit.z-scanZ);
  float lineBand=exp(-0.5*(dz*dz)/(sigma*sigma));
  float taper=clamp(uPhaseTaper,0.0,0.49);
  float headFade=smoother01(0.0,taper,phase);
  float tailFade=1.0-smoother01(1.0-taper,1.0,phase);
  float phaseWindow=headFade*tailFade;
  float combinedPulse=lineBand*phaseWindow*clamp(uScanOpacity,0.0,1.0);
  float auraBand=exp(-0.5*(dz*dz)/(sigmaA*sigmaA));
  float combinedAura=(auraBand*0.25)*phaseWindow*clamp(uScanOpacity,0.0,1.0);
  vec3 gridCol=uLinesColor*lineMask*fade;
  vec3 scanCol=uScanColor*combinedPulse;
  vec3 scanAura=uScanColor*combinedAura;
  color=gridCol+scanCol+scanAura;
  float n=fract(sin(dot(gl_FragCoord.xy+vec2(iTime*123.4),vec2(12.9898,78.233)))*43758.5453123);
  color+=(n-0.5)*uNoise;
  color=clamp(color,0.0,1.0);
  float alpha=clamp(max(lineMask*fade,combinedPulse),0.0,1.0);
  fragColor=vec4(color,alpha);
}

void main(){
  vec4 c;
  mainImage(c,vUv*iResolution.xy);
  gl_FragColor=c;
}
`

function srgbColor(hex: string) {
  const c = new THREE.Color(hex)
  return c.convertSRGBToLinear()
}

type Props = {
  sensitivity?: number
  lineThickness?: number
  linesColor?: string
  scanColor?: string
  scanOpacity?: number
  gridScale?: number
  enablePost?: boolean
  bloomIntensity?: number
  chromaticAberration?: number
  noiseIntensity?: number
  scanGlow?: number
  scanSoftness?: number
  scanDuration?: number
  scanDelay?: number
  style?: React.CSSProperties
}

export default function GridScan({
  sensitivity = 0.55,
  lineThickness = 1,
  linesColor = '#2F293A',
  scanColor = '#FF9FFC',
  scanOpacity = 0.4,
  gridScale = 0.1,
  enablePost = true,
  bloomIntensity = 0.6,
  chromaticAberration = 0.002,
  noiseIntensity = 0.01,
  scanGlow = 0.5,
  scanSoftness = 2,
  scanDuration = 2.0,
  scanDelay = 2.0,
  style,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mouseRef = useRef({ x: 0, y: 0 })
  const smoothRef = useRef({ x: 0, y: 0 })

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setClearColor(0x000000, 0)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(el.clientWidth, el.clientHeight)
    el.appendChild(renderer.domElement)

    const s = THREE.MathUtils.clamp(sensitivity, 0, 1)
    const skewScale = THREE.MathUtils.lerp(0.06, 0.2, s)

    const uniforms: Record<string, { value: any }> = {
      iResolution: { value: new THREE.Vector3(el.clientWidth, el.clientHeight, 1) },
      iTime: { value: 0 },
      uSkew: { value: new THREE.Vector2(0, 0) },
      uTilt: { value: 0 },
      uYaw: { value: 0 },
      uLineThickness: { value: lineThickness },
      uLinesColor: { value: srgbColor(linesColor) },
      uScanColor: { value: srgbColor(scanColor) },
      uGridScale: { value: gridScale },
      uScanOpacity: { value: scanOpacity },
      uNoise: { value: noiseIntensity },
      uBloomOpacity: { value: bloomIntensity },
      uScanGlow: { value: scanGlow },
      uScanSoftness: { value: scanSoftness },
      uPhaseTaper: { value: 0.9 },
      uScanDuration: { value: scanDuration },
      uScanDelay: { value: scanDelay },
      uScanDirection: { value: 2 },
    }

    const material = new THREE.ShaderMaterial({ uniforms, vertexShader: vert, fragmentShader: frag, transparent: true, depthWrite: false })
    const scene = new THREE.Scene()
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material)
    scene.add(quad)

    let composer: EffectComposer | null = null
    if (enablePost) {
      composer = new EffectComposer(renderer)
      composer.addPass(new RenderPass(scene, camera))
      const bloom = new BloomEffect({ intensity: bloomIntensity, luminanceThreshold: 0, luminanceSmoothing: 0 })
      const chroma = new ChromaticAberrationEffect({ offset: new THREE.Vector2(chromaticAberration, chromaticAberration), radialModulation: false, modulationOffset: 0 })
      const ep = new EffectPass(camera, bloom, chroma)
      ep.renderToScreen = true
      composer.addPass(ep)
    }

    const resize = () => {
      renderer.setSize(el.clientWidth, el.clientHeight)
      uniforms.iResolution.value.set(el.clientWidth, el.clientHeight, 1)
      composer?.setSize(el.clientWidth, el.clientHeight)
    }
    window.addEventListener('resize', resize)

    const onMove = (e: MouseEvent) => {
      const rect = el.getBoundingClientRect()
      mouseRef.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
      mouseRef.current.y = -(((e.clientY - rect.top) / rect.height) * 2 - 1)
    }
    el.addEventListener('mousemove', onMove)

    let last = performance.now()
    let raf: number
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const now = performance.now()
      const dt = Math.min((now - last) / 1000, 0.1)
      last = now

      const lp = 1 - Math.pow(0.05, dt)
      smoothRef.current.x += (mouseRef.current.x - smoothRef.current.x) * lp
      smoothRef.current.y += (mouseRef.current.y - smoothRef.current.y) * lp

      uniforms.uSkew.value.set(smoothRef.current.x * skewScale, -smoothRef.current.y * skewScale)
      uniforms.iTime.value = now / 1000

      renderer.clear(true, true, true)
      if (composer) composer.render(dt)
      else renderer.render(scene, camera)
    }
    raf = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
      el.removeEventListener('mousemove', onMove)
      composer?.dispose()
      renderer.dispose()
      if (el.contains(renderer.domElement)) el.removeChild(renderer.domElement)
    }
  }, [])

  return <div ref={containerRef} className="gridscan" style={{ position: 'absolute', inset: 0, ...style }} />
}
