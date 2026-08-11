import './BrandLogo.css'

export default function BrandLogo({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand-logo${compact ? ' compact' : ''}`}>
      <img src={`${import.meta.env.BASE_URL}winweb-logo.svg`} alt="Winweb – Food Software Specialists" />
      {!compact && <span>Notiz App</span>}
    </div>
  )
}

