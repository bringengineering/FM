"use client";

import {
  createContext,
  type MouseEvent,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import CompactEstimateForm from "./CompactEstimateForm";

type ExperienceValue = {
  open(opener: HTMLElement): void;
};

const QuickEstimateContext = createContext<ExperienceValue | null>(null);

type ExperienceProps = {
  children: ReactNode;
  service: string;
  sourcePath: string;
  defaultCustomerType: "building_owner" | "individual";
  needsPlaceholder: string;
};

type TriggerProps = {
  children: ReactNode;
  className?: string;
  ariaLabel?: string;
};

export function QuickEstimateTrigger({
  children,
  className,
  ariaLabel,
}: TriggerProps) {
  const experience = useContext(QuickEstimateContext);

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    if (!experience) return;
    event.preventDefault();
    experience.open(event.currentTarget);
  }

  return (
    <a
      className={className}
      href="#quick-estimate"
      aria-label={ariaLabel}
      onClick={handleClick}
    >
      {children}
    </a>
  );
}

export function QuickEstimateExperience(props: ExperienceProps) {
  const { children, ...formProps } = props;
  const [isOpen, setIsOpen] = useState(false);
  const openerRef = useRef<HTMLElement | null>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);

  function open(opener: HTMLElement) {
    openerRef.current = opener;
    setIsOpen(true);
  }

  function close() {
    setIsOpen(false);
    requestAnimationFrame(() => openerRef.current?.focus());
  }

  useEffect(() => {
    if (!isOpen) return;
    const previousOverflow = document.body.style.overflow;
    const page = pageRef.current;
    document.body.style.overflow = "hidden";
    page?.setAttribute("inert", "");
    page?.setAttribute("aria-hidden", "true");

    const phoneInput = dialogRef.current?.querySelector<HTMLInputElement>(
      'input[name="phone"]',
    );
    phoneInput?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((element) => !element.hasAttribute("hidden"));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      page?.removeAttribute("inert");
      page?.removeAttribute("aria-hidden");
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen]);

  return (
    <QuickEstimateContext.Provider value={{ open }}>
      <div className="quick-estimate-page" ref={pageRef}>
        {children}
      </div>
      <QuickEstimateTrigger
        className="quick-estimate-floating"
        ariaLabel="빠른 견적 열기"
      >
        30초 견적
      </QuickEstimateTrigger>
      {isOpen ? (
        <div
          className="quick-estimate-backdrop"
          onMouseDown={(event) => event.target === event.currentTarget && close()}
        >
          <section
            className="quick-estimate-dialog"
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="quick-estimate-dialog-title"
          >
            <button
              className="quick-estimate-close"
              type="button"
              onClick={close}
              aria-label="빠른 견적 닫기"
            >
              ×
            </button>
            <CompactEstimateForm
              {...formProps}
              titleId="quick-estimate-dialog-title"
            />
          </section>
        </div>
      ) : null}
    </QuickEstimateContext.Provider>
  );
}
