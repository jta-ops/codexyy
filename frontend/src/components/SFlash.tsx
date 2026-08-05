import { useEffect, useState } from 'react'
import FloatingLines from './FloatingLines'

export default function SFlash() {
  const [active, setActive] = useState(false)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 's' && !e.metaKey && !e.ctrlKey && !e.altKey &&
          !(e.target instanceof HTMLInputElement) &&
          !(e.target instanceof HTMLTextAreaElement)) {
        setActive(true)
        setTimeout(() => setActive(false), 2000)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  if (!active) return null

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: '#04040a',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      animation: 'sflash-in 0.15s ease forwards',
      overflow: 'hidden',
    }}>
      <style>{`
        @keyframes sflash-in {
          from { opacity: 0; transform: scale(1.04); }
          to   { opacity: 1; transform: scale(1); }
        }
        @keyframes sflash-scan {
          from { top: -2px; opacity: 0; }
          5%   { opacity: 1; }
          95%  { opacity: 0.8; }
          to   { top: 100%; opacity: 0; }
        }
        @keyframes sflash-exit {
          0%   { opacity: 1; transform: scale(1); }
          70%  { opacity: 1; transform: scale(1); }
          100% { opacity: 0; transform: scale(1.05); }
        }
        .sflash-root { animation: sflash-exit 2s ease forwards; }
        .sflash-scan { animation: sflash-scan 1s cubic-bezier(0.4,0,0.55,1) 0.1s forwards; }
        .sflash-logo span {
          display: inline-block;
          opacity: 0;
          transform: translateY(18px) scale(0.85);
          filter: blur(6px);
          animation: sflash-char 0.4s cubic-bezier(0.2,1,0.4,1) forwards;
        }
        @keyframes sflash-char {
          to { opacity: 1; transform: translateY(0) scale(1); filter: blur(0); }
        }
      `}</style>

      <div className="sflash-root" style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
        {/* Lines bg */}
        <div style={{ position: 'absolute', inset: 0 }}>
          <FloatingLines
            enabledWaves={['top', 'middle', 'bottom']}
            lineCount={8}
            lineDistance={8}
            bendRadius={8}
            bendStrength={-2}
            interactive={false}
            parallax={false}
            animationSpeed={1.4}
            linesGradient={['#00d4ff', '#a78bfa', '#4effa8', '#00d4ff']}
            mixBlendMode="screen"
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
          />
        </div>

        {/* Grid */}
        <div style={{
          position: 'absolute', inset: 0,
          backgroundImage: 'linear-gradient(rgba(0,212,255,0.05) 1px,transparent 1px),linear-gradient(90deg,rgba(0,212,255,0.05) 1px,transparent 1px)',
          backgroundSize: '48px 48px',
          pointerEvents: 'none',
        }} />

        {/* Scan */}
        <div className="sflash-scan" style={{
          position: 'absolute', left: 0, right: 0, height: '1px', top: '-2px',
          background: 'linear-gradient(90deg,transparent,#00d4ff 30%,rgba(0,212,255,0.9) 50%,#00d4ff 70%,transparent)',
          boxShadow: '0 0 24px 6px rgba(0,212,255,0.22)',
          pointerEvents: 'none',
        }} />

        {/* Logo */}
        <div style={{ position: 'relative', zIndex: 2, textAlign: 'center', filter: 'drop-shadow(0 0 36px rgba(0,212,255,0.6)) drop-shadow(0 0 80px rgba(0,212,255,0.2))' }}>
          <div className="sflash-logo" style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 'clamp(40px, 7vw, 72px)',
            fontWeight: 600,
            letterSpacing: '-1.5px',
            display: 'flex', alignItems: 'baseline',
          }}>
            {'codexyy'.split('').map((ch, i) => (
              <span key={i} style={{ color: '#e2e2ec', animationDelay: `${0.1 + i * 0.055}s` }}>{ch}</span>
            ))}
            <span style={{ color: '#00d4ff', animationDelay: '0.53s' }}>.</span>
            {'dev'.split('').map((ch, i) => (
              <span key={i} style={{ color: '#00d4ff', fontSize: '0.62em', animationDelay: `${0.59 + i * 0.055}s` }}>{ch}</span>
            ))}
          </div>
          <div style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '11px', letterSpacing: '0.3em',
            textTransform: 'uppercase', color: 'rgba(0,212,255,0.65)',
            marginTop: '8px',
            animation: 'sflash-char 0.4s 0.75s ease forwards',
            opacity: 0,
          }}>
            playground
          </div>
        </div>

        {/* Bottom bar */}
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0, height: '1px',
          background: 'rgba(255,255,255,0.04)', overflow: 'hidden',
        }}>
          <div style={{
            height: '100%',
            background: 'linear-gradient(90deg,#00d4ff,#a78bfa,#4effa8,#00d4ff)',
            boxShadow: '0 0 12px rgba(0,212,255,0.9)',
            animation: 'sflash-bar 1.8s linear forwards',
          }} />
          <style>{`@keyframes sflash-bar { from { width: 0%; } to { width: 100%; } }`}</style>
        </div>
      </div>
    </div>
  )
}
