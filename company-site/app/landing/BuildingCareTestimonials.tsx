export type BuildingCareTestimonial = {
  id: string;
  customerType: string;
  quote: string;
  image: string;
  imageAlt: string;
  tags: readonly string[];
  sourceImage?: string;
};

export const verifiedTestimonials: readonly BuildingCareTestimonial[] = [];

export default function BuildingCareTestimonials({ items = verifiedTestimonials }: { items?: readonly BuildingCareTestimonial[] }) {
  if (items.length === 0) return null;

  return <section id="customer-testimonials" className="bc-section bc-testimonials-section">
    <div className="bc-shell">
      <header className="bc-heading">
        <p className="bc-kicker">VERIFIED CUSTOMER VOICE</p>
        <h2>실제 이용 후기로 확인하세요.</h2>
        <p>고객이 직접 남긴 내용과 해당 현장 사진만 선별해 공개합니다.</p>
      </header>
      <div className="bc-testimonial-grid">
        {items.map((item) => <article className="bc-testimonial-card" key={item.id}>
          <div className="bc-testimonial-image"><Image src={item.image} alt={item.imageAlt} fill unoptimized sizes="(max-width: 700px) 100vw, 33vw" /></div>
          <div className="bc-testimonial-copy"><span>{item.customerType}</span><blockquote>{item.quote}</blockquote><div>{item.tags.map((tag) => <b key={tag}>#{tag}</b>)}</div></div>
        </article>)}
      </div>
    </div>
  </section>;
}
import Image from "next/image";
