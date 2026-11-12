// 맥 브라우저 미리보기 전용: ?real 은 실제 화면(가상 데이터), ?proto 는 흐름 시안.
import { FlowPrototype } from './prototype/FlowPrototype';
import { RealPreview } from './prototype/RealPreview';
export const previewFor = (search: string) => search.includes('real') ? RealPreview : search.includes('proto') ? FlowPrototype : null;
