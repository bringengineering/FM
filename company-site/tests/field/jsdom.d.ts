// jsdom 은 타입 선언을 같이 주지 않는다. @types/jsdom 을 더할 수도 있지만,
// 여기서 쓰는 것은 생성자와 window 하나뿐이라 그만큼만 적어 둔다.
// 의존성을 하나 늘리는 것보다 여덟 줄이 낫다.
declare module "jsdom" {
  export class JSDOM {
    constructor(html?: string, options?: Record<string, unknown>);
    readonly window: Window & typeof globalThis & Record<string, unknown>;
  }
}
