import {
  PRICE_DISCLAIMERS,
  PUBLIC_PRICES,
  VAT_NOTE,
  type PublicPriceId,
} from "./pricing";

type PricingGridProps = {
  activePrice: PublicPriceId;
};

export default function PricingGrid({ activePrice }: PricingGridProps) {
  return (
    <section className="landing-pricing" aria-labelledby="pricing-title">
      <div className="landing-section-inner">
        <div className="landing-section-heading">
          <p>서비스·가격</p>
          <h2 id="pricing-title">필요한 범위부터 투명하게 시작합니다.</h2>
          <span>{VAT_NOTE}</span>
        </div>
        <div className="landing-pricing-grid">
          {PUBLIC_PRICES.map((plan) => (
            <article
              className={`landing-price-plan${
                plan.id === activePrice ? " landing-price-plan-active" : ""
              }`}
              data-price-id={plan.id}
              key={plan.id}
            >
              <p>{plan.label}</p>
              <h3>{plan.price}</h3>
              <span>{plan.basis}</span>
              <strong>부가세 별도</strong>
              <ul>
                {plan.includes.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>
        <ul className="landing-pricing-notes">
          {PRICE_DISCLAIMERS.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}
