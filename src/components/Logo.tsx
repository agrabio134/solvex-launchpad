export default function Logo({ size = 28 }: { size?: number }) {
  return <img src="/logo.png" width={size} height={size} alt="Solvex" style={{ borderRadius: size * 0.26, display: 'block' }} />
}
