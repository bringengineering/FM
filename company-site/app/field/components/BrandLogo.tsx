type BrandLogoProps = {
  className?: string;
};

export default function BrandLogo({ className = "" }: BrandLogoProps) {
  return (
    // The public asset is used directly so Firebase static hosting does not need an image optimizer.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className={`field-brand-logo ${className}`.trim()}
      src="/bring-care-logo.png"
      alt="Bring Care"
      width={1078}
      height={200}
    />
  );
}
