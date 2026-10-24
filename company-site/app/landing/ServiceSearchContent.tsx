import { buildServiceStructuredData, serviceSearchData, type ServiceSlug } from "./serviceSearchData";

export default function ServiceSearchContent({ slug }: { slug: ServiceSlug }) {
  const service = serviceSearchData[slug];
  return (
    <div className="search-faq" role="region" aria-labelledby={`${slug}-search-faq-title`}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(buildServiceStructuredData(slug)) }} />
      <div className="search-faq-inner">
        <p>FAQ</p>
        <h2 id={`${slug}-search-faq-title`}>{service.name} 자주 묻는 질문</h2>
        <div>{service.faq.map(([question, answer]) => <details key={question}><summary>{question}</summary><p>{answer}</p></details>)}</div>
      </div>
    </div>
  );
}
