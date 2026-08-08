import logoImg from '../../public/logo.png';

export default function BrandLogo({ className = '', label = 'MEALS' }) {
  return (
    <img
      src={logoImg}
      alt={`${label} logo`}
      className={`brand-logo-mark inline-block shrink-0 object-contain rounded-full ${className}`}
    />
  );
}
