import { useEffect, useRef } from 'react'
import { Renderer, Program, Mesh, Color, Triangle } from 'ogl'

const VERT = `#version 300 es
in vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}
`

const FRAG = `#version 300 es
precision highp float;
uniform float uTime;
uniform float uAmplitude;
uniform vec3 uColorStops[3];
uniform vec2 uResolution;
uniform float uBlend;
out vec4 fragColor;

vec3 permute(vec3 x) { return mod(((x*34.0)+1.0)*x,289.0); }
float snoise(vec2 v){
  const vec4 C=vec4(0.211324865405187,0.366025403784439,-0.577350269189626,0.024390243902439);
  vec2 i=floor(v+dot(v,C.yy));
  vec2 x0=v-i+dot(i,C.xx);
  vec2 i1=(x0.x>x0.y)?vec2(1.0,0.0):vec2(0.0,1.0);
  vec4 x12=x0.xyxy+C.xxzz;
  x12.xy-=i1;
  i=mod(i,289.0);
  vec3 p=permute(permute(i.y+vec3(0.0,i1.y,1.0))+i.x+vec3(0.0,i1.x,1.0));
  vec3 m=max(0.5-vec3(dot(x0,x0),dot(x12.xy,x12.xy),dot(x12.zw,x12.zw)),0.0);
  m=m*m*m*m;
  vec3 x=2.0*fract(p*C.www)-1.0;
  vec3 h=abs(x)-0.5;
  vec3 ox=floor(x+0.5);
  vec3 a0=x-ox;
  m*=1.79284291400159-0.85373472095314*(a0*a0+h*h);
  vec3 g;
  g.x=a0.x*x0.x+h.x*x0.y;
  g.yz=a0.yz*x12.xz+h.yz*x12.yw;
  return 130.0*dot(m,g);
}

void main(){
  vec2 uv=gl_FragCoord.xy/uResolution;
  vec3 rampColor;
  float factor=uv.x;
  if(factor<0.5){ rampColor=mix(uColorStops[0],uColorStops[1],factor*2.0); }
  else { rampColor=mix(uColorStops[1],uColorStops[2],(factor-0.5)*2.0); }
  float height=snoise(vec2(uv.x*2.0+uTime*0.1,uTime*0.25))*0.5*uAmplitude;
  height=exp(height);
  height=(uv.y*2.0-height+0.2);
  float intensity=0.6*height;
  float midPoint=0.20;
  float auroraAlpha=smoothstep(midPoint-uBlend*0.5,midPoint+uBlend*0.5,intensity);
  vec3 auroraColor=intensity*rampColor;
  fragColor=vec4(auroraColor*auroraAlpha,auroraAlpha);
}
`

interface AuroraProps {
  colorStops?: string[]
  amplitude?: number
  blend?: number
  speed?: number
  style?: React.CSSProperties
}

export default function Aurora({
  colorStops = ['#00d4ff', '#a78bfa', '#00d4ff'],
  amplitude = 1.0,
  blend = 0.5,
  speed = 1.0,
  style,
}: AuroraProps) {
  const ctnRef = useRef<HTMLDivElement>(null)
  const propsRef = useRef({ colorStops, amplitude, blend, speed })
  propsRef.current = { colorStops, amplitude, blend, speed }

  useEffect(() => {
    const ctn = ctnRef.current
    if (!ctn) return

    const renderer = new Renderer({ alpha: true, premultipliedAlpha: true, antialias: true })
    const gl = renderer.gl
    gl.clearColor(0, 0, 0, 0)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)

    let program: Program

    const resize = () => {
      const w = ctn.offsetWidth, h = ctn.offsetHeight
      renderer.setSize(w, h)
      if (program) program.uniforms.uResolution.value = [w, h]
    }
    window.addEventListener('resize', resize)

    const geometry = new Triangle(gl)
    if ((geometry.attributes as any).uv) delete (geometry.attributes as any).uv

    const toRgb = (hex: string) => { const c = new Color(hex); return [c.r, c.g, c.b] }

    program = new Program(gl, {
      vertex: VERT,
      fragment: FRAG,
      uniforms: {
        uTime: { value: 0 },
        uAmplitude: { value: amplitude },
        uColorStops: { value: colorStops.map(toRgb) },
        uResolution: { value: [ctn.offsetWidth, ctn.offsetHeight] },
        uBlend: { value: blend },
      },
    })

    const mesh = new Mesh(gl, { geometry, program })
    ctn.appendChild(gl.canvas)

    let rafId = 0
    const tick = (t: number) => {
      rafId = requestAnimationFrame(tick)
      const p = propsRef.current
      program.uniforms.uTime.value = t * 0.001 * p.speed * 0.1
      program.uniforms.uAmplitude.value = p.amplitude ?? amplitude
      program.uniforms.uBlend.value = p.blend ?? blend
      program.uniforms.uColorStops.value = (p.colorStops ?? colorStops).map(toRgb)
      renderer.render({ scene: mesh })
    }
    rafId = requestAnimationFrame(tick)
    resize()

    return () => {
      cancelAnimationFrame(rafId)
      window.removeEventListener('resize', resize)
      if (ctn && gl.canvas.parentNode === ctn) ctn.removeChild(gl.canvas)
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    }
  }, [])

  return (
    <div
      ref={ctnRef}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        ...style,
      }}
    />
  )
}
