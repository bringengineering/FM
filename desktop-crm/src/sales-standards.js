(function attachBringSalesStandards(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BringSalesStandards = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function makeBringSalesStandards() {
  const doctrine = "공실 해결로 첫 관계를 만들고, 임대관리 성과를 보여준 뒤 청소·수리·건물관리로 확장한다.";

  const rawScripts = [
    {
      id: "S1",
      version: "1.0",
      name: "검증기준문 S1",
      situation: "공실 확인 문자",
      channel: "문자",
      status: "법률검토",
      evidenceStatus: "검증",
      usageStatus: "모의 역할극 전용",
      objective: "서비스를 길게 설명하지 않고 현재 공실 또는 퇴실 예정 여부만 확인한다.",
      text: `안녕하세요. 이지부동산중개법인(주)입니다.
원주 지역 원룸·다가구 임대차 중개를 진행하고 있습니다.
혹시 현재 공실이나 퇴실 예정인 호실이 있으실까요?
건물주분께는 별도의 중개보수를 받지 않으며, 임차인 측 중개보수만 법정 기준에 따라 진행하고 있습니다.
편하게 공실 여부만 답변 주시면 감사하겠습니다. 감사합니다.`,
      guardrails: [
        "발송 전 연락처 출처, 발송주체 권한, 광고성 정보 규정과 수신거부 절차를 확인한다.",
        "중개보수 문구는 협력 공인중개사가 승인한 경우에만 그대로 사용한다.",
        "수신거부 또는 명확한 거절은 즉시 중단목록에 기록한다.",
      ],
      forbiddenPhrases: ["무조건 임대됩니다", "오늘만 무료", "수신거부해도 다시 연락드리겠습니다"],
      nextStep: "공실·퇴실예정 응답이면 R1 또는 R2로 분류하고 15분 이내에 기초정보 확인 연락을 한다.",
      event: "response_received",
      externalApproval: "협력 공인중개사 최종 검토 필요",
    },
    {
      id: "S2",
      version: "1.0",
      name: "30초 전화 오프닝",
      situation: "전화 오프닝",
      channel: "전화",
      status: "법률검토",
      evidenceStatus: "계획",
      objective: "통화 허락을 얻고 공실 여부와 담당자 여부를 30초 안에 확인한다.",
      text: `안녕하세요, 이지부동산중개법인 브링케어 담당자 ○○○입니다.
건물에 공개된 임대문의 연락처를 보고 전화드렸습니다. 지금 30초 정도 통화 괜찮으실까요?
현재 공실이나 곧 퇴실 예정인 호실이 있는지만 여쭤보려고 합니다.`,
      guardrails: [
        "소유자라고 단정하지 말고 임대 담당자 여부를 확인한다.",
        "통화가 어렵다고 하면 가능한 시간만 묻고 즉시 종료한다.",
        "가격·계약조건을 즉석에서 확정하지 않는다.",
      ],
      forbiddenPhrases: ["제가 건물주님 맞는 걸 알고 있습니다", "무조건 계약됩니다", "지금 결정하셔야 합니다"],
      nextStep: "공실이 있으면 상담 체크리스트를 열고, 없으면 관리문제 또는 재연락 동의 여부만 확인한다.",
      event: "response_received",
    },
    {
      id: "S3",
      version: "1.0",
      name: "건물주 방문 첫 인사",
      situation: "건물주 방문",
      channel: "방문",
      status: "법률검토",
      evidenceStatus: "실험",
      objective: "신분과 방문목적을 밝히고 임대 담당자와 짧은 대화 또는 자료 전달 동의를 얻는다.",
      text: `안녕하세요. 이지부동산중개법인과 함께 원주 원룸 공실을 관리하는 브링케어 ○○○입니다.
이 건물 임대 담당자분께 공실 모집 지원 내용을 1분만 설명드려도 될까요?
담당자가 아니시면 명함이나 안내문을 전달해 주셔도 괜찮을까요?`,
      guardrails: [
        "영업금지 표시, 업무방해 요청, 거절 의사를 존중한다.",
        "1층 상가 직원에게 건물주의 개인정보를 요구하지 않는다.",
        "무단으로 공용부 내부를 촬영하거나 출입하지 않는다.",
      ],
      forbiddenPhrases: ["건물주 번호를 알려주세요", "잠깐 들어가 보겠습니다", "저희가 다 책임집니다"],
      nextStep: "직접 대화하면 반응을 분류하고, 전달만 동의하면 소개경로와 재확인 가능일을 기록한다.",
      event: "response_received",
    },
    {
      id: "S4",
      version: "1.0",
      name: "공인중개사 협업 제안",
      situation: "공인중개사 협업",
      channel: "방문·전화",
      status: "초안",
      evidenceStatus: "조건부",
      objective: "상대 중개사의 구체적 이익과 역할을 먼저 제시하고 협업 가능성을 확인한다.",
      text: `저희는 대학가 원룸 건물의 공실정보를 직접 발굴하고 사진·기초정보·현장일정을 정리하고 있습니다.
귀 사무소에서는 임차인 연결과 법정 중개절차를 담당하고, 저희는 건물주 소통과 현장 준비를 맡는 방식의 협업을 검토하고 싶습니다.
현재 필요하신 매물 유형과 매물공유 기준을 먼저 여쭤봐도 될까요?`,
      guardrails: [
        "정산비율과 독점권을 팀원이 임의로 약속하지 않는다.",
        "협업 상대의 등록상태와 대표 승인 전 매물정보를 일괄 제공하지 않는다.",
      ],
      forbiddenPhrases: ["수익은 무조건 반반입니다", "독점으로 드립니다", "계약은 저희가 작성합니다"],
      nextStep: "관심이 있으면 대표와 20분 협업미팅을 예약하고 필요한 매물유형·정산질문을 인계한다.",
      event: "meeting_booked",
    },
    {
      id: "S5",
      version: "1.0",
      name: "미팅 확정 문자",
      situation: "미팅 확정",
      channel: "문자",
      status: "초안",
      evidenceStatus: "계획",
      objective: "일시·장소·참석자·준비정보를 한 번에 확정해 노쇼와 재질문을 줄인다.",
      text: `말씀 감사합니다. ○월 ○일 ○시, ○○건물 앞에서 뵙겠습니다.
공실 호실 수와 보증금·월세·관리비, 기존 광고 여부를 확인하고 사진촬영 동의를 여쭙겠습니다.
일정 변경 시 이 번호로 알려주시면 바로 조정하겠습니다.`,
      guardrails: [
        "사진촬영과 출입은 현장에서 다시 동의를 받는다.",
        "계약이나 가격 확정 미팅으로 표현하지 않는다.",
      ],
      forbiddenPhrases: ["그날 계약까지 끝냅니다", "촬영은 당연히 합니다", "금액은 확정입니다"],
      nextStep: "캘린더와 미팅현장진단표에 등록하고 담당자·출발시간을 지정한다.",
      event: "meeting_booked",
    },
    {
      id: "S6",
      version: "1.0",
      name: "합의된 무응답 후속연락",
      situation: "무응답 후속연락",
      channel: "문자",
      status: "법률검토",
      evidenceStatus: "계획",
      objective: "허용된 범위에서 한 번만 맥락을 상기시키고 답변 선택지를 단순화한다.",
      text: `안녕하세요, 앞서 공실 여부를 여쭤본 이지부동산중개법인 브링케어 ○○○입니다.
현재 공실 있음 / 퇴실 예정 있음 / 현재 없음 중 하나만 답해주셔도 됩니다.
연락을 원하지 않으시면 말씀 주시는 즉시 중단하겠습니다. 감사합니다.`,
      guardrails: [
        "최초 발송의 적법성과 후속연락 근거가 확인된 건에만 사용한다.",
        "거절·수신거부 기록이 있거나 재연락 동의·기준일이 없으면 보내지 않는다.",
      ],
      forbiddenPhrases: ["답이 없으셔서 계속 연락드립니다", "마지막 기회입니다", "번호를 바꿔 다시 드립니다"],
      nextStep: "응답은 즉시 분류하고, 무응답이면 추가 반복발송 없이 종료 또는 승인대기로 둔다.",
      event: "response_received",
    },
    {
      id: "S7",
      version: "1.0",
      name: "성과 후 소개 요청",
      situation: "소개 요청",
      channel: "전화·대면",
      status: "초안",
      evidenceStatus: "계획",
      objective: "성과를 먼저 확인받은 뒤 비슷한 고민이 있는 건물주 한 명의 자발적 소개를 요청한다.",
      text: `이번 공실 진행에서 도움이 된 부분과 부족했던 부분을 먼저 듣고 싶습니다.
도움이 되셨다면 주변에 공실이나 관리 때문에 불편한 건물주분 한 분께 저희 연락처를 전달해 주실 수 있을까요?
개인정보를 바로 주시기보다 그분 동의를 받은 뒤 연결해 주시면 됩니다.`,
      guardrails: [
        "성과가 확인되기 전 소개를 압박하지 않는다.",
        "제3자의 번호를 동의 없이 요구하거나 저장하지 않는다.",
      ],
      forbiddenPhrases: ["번호만 바로 주세요", "소개는 꼭 해주셔야 합니다", "동의 없어도 연락해 보겠습니다"],
      nextStep: "소개동의와 연결방식을 기록하고, 소개받은 사람의 직접 동의 전 영업발송을 하지 않는다.",
      event: "valid_contact_found",
    },
    {
      id: "S8",
      version: "1.0",
      name: "문제기반 추가서비스 제안",
      situation: "추가서비스 제안",
      channel: "전화·대면",
      status: "초안",
      evidenceStatus: "계획",
      objective: "확인된 문제 하나에만 비용·일정 확인 제안을 연결한다.",
      text: `현장에서 확인한 ○○ 문제는 입주 전 처리해야 문의 이탈을 줄일 수 있어 보입니다.
원하시면 청소·수리 협력업체의 범위와 견적을 비교해 드리고, 승인하신 뒤 일정까지 관리하겠습니다.
먼저 견적만 받아보실까요?`,
      guardrails: [
        "현장 확인 없이 필요성을 단정하지 않는다.",
        "업체 가격·품질·완료일을 승인 전에 보증하지 않는다.",
      ],
      forbiddenPhrases: ["무조건 최저가입니다", "하자는 절대 없습니다", "오늘 바로 끝납니다"],
      nextStep: "견적 동의면 작업범위·사진·희망일을 대표에게 인계하고, 거절이면 기존 서비스만 유지한다.",
      event: "quote_requested",
    },
    {
      id: "S9",
      version: "1.0",
      name: "가격질문 응답",
      situation: "가격질문",
      channel: "전체",
      status: "초안",
      evidenceStatus: "계획",
      objective: "즉석 할인 없이 필요한 범위와 승인절차를 설명한다.",
      text: `정확한 금액은 호실 수, 방문빈도, 민원·수리 범위를 확인해야 안내할 수 있습니다.
기본 범위를 정리해 대표에게 전달한 뒤 승인된 견적으로 다시 말씀드리겠습니다.
가장 꼭 맡기고 싶은 업무가 무엇인지 먼저 여쭤봐도 될까요?`,
      guardrails: [
        "전단지 가격을 모든 건물에 자동 적용한다고 말하지 않는다.",
        "무료, 최저가, 무조건 할인 표현을 사용하지 않는다.",
      ],
      forbiddenPhrases: ["제가 알아서 할인해 드립니다", "무조건 무료입니다", "어디보다 쌉니다"],
      nextStep: "요구범위와 예산질문을 기록해 대표 가격승인 단계로 인계한다.",
      event: "diagnosis_completed",
    },
    {
      id: "S10",
      version: "1.0",
      name: "법률·계약질문 인계",
      situation: "법률질문",
      channel: "전체",
      status: "법률검토",
      evidenceStatus: "계획",
      objective: "추측 답변을 중단하고 협력 공인중개사에게 정확히 인계한다.",
      text: `그 부분은 계약조건과 법정 확인·설명에 해당할 수 있어 제가 임의로 답변드리지 않겠습니다.
질문을 그대로 기록해 담당 공인중개사가 확인 후 안내드리도록 하겠습니다.`,
      guardrails: [
        "경험이나 인터넷 정보로 법률결론을 말하지 않는다.",
        "가능하다, 문제없다, 책임지겠다는 표현을 사용하지 않는다.",
      ],
      forbiddenPhrases: ["법적으로 문제없습니다", "제가 확실히 압니다", "그 조건으로 계약하시면 됩니다"],
      nextStep: "질문 원문과 답변 희망기한을 기록해 협력 공인중개사에게 즉시 인계한다.",
      event: "diagnosis_completed",
    },
    {
      id: "S11",
      version: "1.0",
      name: "명확한 거절 종료",
      situation: "수신거부",
      channel: "전체",
      status: "법률검토",
      evidenceStatus: "계획",
      objective: "논쟁하지 않고 연락중단 의사를 확인·기록한다.",
      text: "알겠습니다. 불편을 드려 죄송합니다. 이 연락처에는 추가 영업 연락을 드리지 않도록 바로 기록하겠습니다.",
      guardrails: [
        "거절 이유를 캐묻거나 다른 번호로 다시 연락하지 않는다.",
        "종료 후 서비스 설명을 덧붙이지 않는다.",
      ],
      forbiddenPhrases: ["왜 싫으신가요", "한 번만 더 들어보세요", "다른 번호로 연락드릴게요"],
      nextStep: "즉시 수신거부 상태와 일시·채널을 기록하고 모든 예정 후속연락을 취소한다.",
      event: "response_received",
    },
    {
      id: "S12",
      version: "1.0",
      name: "분쟁징후 대응",
      situation: "분쟁징후",
      channel: "전체",
      status: "초안",
      evidenceStatus: "계획",
      objective: "사실만 확인하고 책임 인정이나 반박 없이 대표에게 인계한다.",
      text: `말씀하신 내용을 정확히 기록하겠습니다. 지금 제가 책임 여부나 해결안을 임의로 약속드리지는 않겠습니다.
발생일시, 장소, 관련 작업과 원하시는 조치를 확인해 대표가 다시 연락드리도록 하겠습니다.`,
      guardrails: [
        "잘못을 인정하거나 상대를 탓하는 표현을 하지 않는다.",
        "기록 삭제, 현금보상, 즉시 재작업을 약속하지 않는다.",
      ],
      forbiddenPhrases: ["저희 잘못입니다", "저희 책임이 아닙니다", "현금으로 바로 보상하겠습니다"],
      nextStep: "통화를 종료하기 전 안전상 긴급조치 필요 여부를 확인하고 대표에게 즉시 보고한다.",
      event: "diagnosis_completed",
    },
  ];

  const approvedStatuses = new Set(["대표승인", "표준승인"]);
  const scripts = rawScripts.map(script => {
    const isApproved = approvedStatuses.has(script.status);
    const requiresLegalReview = script.status === "법률검토";
    return Object.freeze({
      ...script,
      isApproved,
      requiresLegalReview,
      usageWarning: isApproved
        ? ""
        : requiresLegalReview
          ? "법률검토 전: 대외 실사용 금지"
          : "미승인 초안: 대외 실사용 금지",
    });
  });

  const checklists = [
    {
      id: "CL01",
      title: "건물조사",
      purpose: "접촉 전에 대상 적합성과 출처를 검증한다.",
      items: [
        { id: "CL01-01", label: "건물 주소와 건물유형을 기록했다", required: true },
        { id: "CL01-02", label: "대학·병원·직장 등 수요거점과 거리를 기록했다", required: true },
        { id: "CL01-03", label: "공개 임대문의 번호와 출처·확인일을 기록했다", required: true },
        { id: "CL01-04", label: "공실·퇴실예정·관리불편 신호를 기록했다", required: true },
        { id: "CL01-05", label: "수신거부·기접촉 중복 여부를 확인했다", required: true },
      ],
      completionRule: "필수 5개가 모두 확인된 건물만 최초접촉 대기열로 이동한다.",
    },
    {
      id: "CL02",
      title: "최초접촉",
      purpose: "승인 대본·권한·기록을 갖추고 안전하게 접촉한다.",
      items: [
        { id: "CL02-01", label: "발송주체와 담당자명이 정확하다", required: true },
        { id: "CL02-02", label: "연락처 출처와 접촉근거가 기록되어 있다", required: true },
        { id: "CL02-03", label: "승인된 S1 또는 채널 대본을 사용했다", required: true },
        { id: "CL02-04", label: "발송일시·담당자·채널을 기록했다", required: true },
        { id: "CL02-05", label: "거절 시 즉시 중단할 준비가 되어 있다", required: true },
      ],
      completionRule: "발송 직후 접촉기록을 저장하고 응답대기 상태와 허용된 다음 일정을 지정한다.",
    },
    {
      id: "CL03",
      title: "상담",
      purpose: "공실과 관리문제를 제안에 필요한 수준까지 사실로 확인한다.",
      items: [
        { id: "CL03-01", label: "상대의 건물 관계와 의사결정권을 확인했다", required: true },
        { id: "CL03-02", label: "공실·퇴실예정 호실 수와 희망일정을 확인했다", required: true },
        { id: "CL03-03", label: "보증금·월세·관리비·옵션을 확인했다", required: true },
        { id: "CL03-04", label: "기존 광고채널과 문의·방문 수를 확인했다", required: true },
        { id: "CL03-05", label: "청소·수리·민원·연체 불편을 확인했다", required: false },
        { id: "CL03-06", label: "다음 행동과 담당자·일정을 합의했다", required: true },
      ],
      completionRule: "가격·법률 질문은 답변하지 않고 인계표시까지 해야 완료다.",
    },
    {
      id: "CL04",
      title: "현장진단",
      purpose: "광고등록과 추가서비스 판단에 필요한 증거를 확보한다.",
      items: [
        { id: "CL04-01", label: "출입과 사진촬영 동의를 받았다", required: true },
        { id: "CL04-02", label: "외관·공용부·호실·옵션·하자 사진을 구분 촬영했다", required: true },
        { id: "CL04-03", label: "주소·호실·열쇠·출입방법을 확인했다", required: true },
        { id: "CL04-04", label: "청소·수리·안전 문제를 구분했다", required: true },
        { id: "CL04-05", label: "건물주 요청과 팀원 관찰을 분리 기록했다", required: true },
        { id: "CL04-06", label: "긴급문제를 대표에게 현장에서 알렸다", required: false },
      ],
      completionRule: "필수사진·기초조건·문제목록이 인계서에 첨부되어야 완료다.",
    },
    {
      id: "CL05",
      title: "대표인계",
      purpose: "대표가 재질문 없이 서비스와 가격을 결정할 수 있게 한다.",
      items: [
        { id: "CL05-01", label: "고객·건물·호실 기본정보가 있다", required: true },
        { id: "CL05-02", label: "공실문제와 관리문제를 우선순위로 정리했다", required: true },
        { id: "CL05-03", label: "사진·견적·기존 광고 자료를 연결했다", required: true },
        { id: "CL05-04", label: "고객 요구가격과 확정가격을 구분했다", required: true },
        { id: "CL05-05", label: "법률·계약 질문을 원문 그대로 기록했다", required: false },
        { id: "CL05-06", label: "의사결정 기한과 다음 연락일을 기록했다", required: true },
      ],
      completionRule: "대표가 수신확인하고 결정해야 할 질문과 기한을 이해해야 완료다.",
    },
    {
      id: "CL06",
      title: "후속조치",
      purpose: "약속한 결과를 보고하고 신뢰가 형성된 시점에만 확장한다.",
      items: [
        { id: "CL06-01", label: "광고·문의·방문·계약 진행상황을 보고했다", required: true },
        { id: "CL06-02", label: "약속한 다음 연락일을 지켰다", required: true },
        { id: "CL06-03", label: "확인된 문제 하나에만 추가서비스를 제안했다", required: false },
        { id: "CL06-04", label: "수락·보류·거절과 이유를 기록했다", required: true },
        { id: "CL06-05", label: "성과 확인 후 소개 또는 다음 공실 연락 동의를 요청했다", required: false },
      ],
      completionRule: "결과상태, 실패이유, 재연락일 중 해당 정보를 모두 기록해야 종료한다.",
    },
    {
      id: "CL07",
      title: "광고등록 준비",
      purpose: "공인중개사가 정확한 매물광고를 검토할 수 있는 기초자료를 정리한다.",
      items: [
        { id: "CL07-01", label: "주소·호실·거래형태·금액을 건물주에게 재확인했다", required: true },
        { id: "CL07-02", label: "관리비와 포함항목·별도항목을 구분했다", required: true },
        { id: "CL07-03", label: "옵션·입주가능일·주차·반려동물 조건을 기록했다", required: true },
        { id: "CL07-04", label: "사진과 설명의 현장일치 여부를 확인했다", required: true },
        { id: "CL07-05", label: "공인중개사의 최종 검토 대기상태로 표시했다", required: true },
      ],
      completionRule: "공인중개사가 확인·설명과 광고 적정성을 검토하기 전 게시완료로 표시하지 않는다.",
    },
    {
      id: "CL08",
      title: "거절·수신거부 처리",
      purpose: "연락중단 의사를 모든 채널과 담당자가 즉시 공유한다.",
      items: [
        { id: "CL08-01", label: "거절 일시·채널·원문을 사실대로 기록했다", required: true },
        { id: "CL08-02", label: "수신거부 상태를 연락처 기준으로 적용했다", required: true },
        { id: "CL08-03", label: "예정된 문자·전화·방문을 취소했다", required: true },
        { id: "CL08-04", label: "다른 팀원에게 중단상태가 보이는지 확인했다", required: true },
      ],
      completionRule: "모든 예정접촉이 취소되고 중복번호에도 중단상태가 반영되어야 완료다.",
    },
  ];

  const catalogs = {
    responseCodes: [
      { id: "R1", label: "현재 공실", nextEvent: "qualified_interest" },
      { id: "R2", label: "퇴실 예정", nextEvent: "qualified_interest" },
      { id: "R3", label: "관리문제만 있음", nextEvent: "qualified_interest" },
      { id: "R4", label: "추후 연락 동의", nextEvent: "response_received" },
      { id: "R5", label: "거절·수신거부", nextEvent: "response_received" },
      { id: "R6", label: "비대상", nextEvent: "response_received" },
    ],
    channels: [
      { id: "CH_SMS", label: "문자" },
      { id: "CH_CALL", label: "전화" },
      { id: "CH_VISIT", label: "방문" },
      { id: "CH_BROKER", label: "공인중개사 협업" },
      { id: "CH_KARROT", label: "당근" },
      { id: "CH_BLOG", label: "네이버 블로그" },
      { id: "CH_SHOP", label: "1층 상가 소개 실험" },
    ],
    contactSources: [
      { id: "SRC_BUILDING", label: "건물 공개 임대문의 번호" },
      { id: "SRC_REFERRAL", label: "동의받은 소개" },
      { id: "SRC_BROKER", label: "공인중개사 협업" },
      { id: "SRC_INBOUND", label: "당근·블로그 인바운드" },
    ],
    results: [
      { id: "RES_ACTIVE", label: "진행" },
      { id: "RES_HOLD", label: "보류" },
      { id: "RES_WON", label: "계약·유료전환" },
      { id: "RES_LOST", label: "종료" },
    ],
    failureReasons: [
      { id: "FAIL_NO_NEED", label: "현재 필요 없음" },
      { id: "FAIL_NO_CONSENT", label: "접촉·후속동의 없음" },
      { id: "FAIL_PRICE", label: "가격·범위 불일치" },
      { id: "FAIL_EXISTING_VENDOR", label: "기존 중개사·업체 유지" },
      { id: "FAIL_LEGAL_GATE", label: "법률·권한 게이트 미충족" },
      { id: "FAIL_OTHER", label: "기타 사실기록" },
    ],
    services: [
      { id: "SV_RENTAL", label: "임대관리" },
      { id: "SV_MANAGEMENT", label: "건물관리" },
      { id: "SV_CLEAN", label: "공용부·입퇴실 청소" },
      { id: "SV_REPAIR", label: "수리·시설작업" },
      { id: "SV_VENDOR", label: "협력업체 연결" },
    ],
    opportunityStatuses: [
      { id: "OPP_VACANT", label: "광고게시 완료·임차인 모집 중" },
      { id: "OPP_SCHEDULED", label: "공실예정" },
      { id: "OPP_AD_PROGRESS", label: "광고등록 진행 중" },
      { id: "OPP_QUOTE", label: "견적요청" },
      { id: "OPP_UNCONFIRMED", label: "미확인 후보" },
    ],
  };

  const funnelEvents = [
    { event: "building_surveyed", label: "건물조사", evidence: "건물ID·주소·유형·수요거점" },
    { event: "valid_contact_found", label: "유효연락처", evidence: "연락처ID·출처·확인일·접촉가능 상태" },
    { event: "contact_attempted", label: "접촉시도", evidence: "일시·채널·대본버전·담당자" },
    { event: "response_received", label: "응답", evidence: "회신 또는 통화결과 원문" },
    { event: "qualified_interest", label: "유효관심", evidence: "공실·퇴실예정·관리문제 중 하나 확인" },
    { event: "meeting_booked", label: "미팅", evidence: "일시·장소·참석자 확정" },
    { event: "diagnosis_completed", label: "현장진단", evidence: "필수정보·사진·문제목록" },
    { event: "listing_intake", label: "매물접수", evidence: "광고등록에 필요한 호실정보 인계" },
    { event: "ad_posted", label: "광고게시", evidence: "공인중개사 검토 및 게시확인" },
    { event: "tenant_inquiry", label: "임차문의", evidence: "문의일시·채널·요청조건" },
    { event: "property_visit", label: "현장방문", evidence: "방문일시·참석자·결과" },
    { event: "lease_signed", label: "임대차계약", evidence: "공인중개사 계약완료 확인" },
    { event: "paid_management_started", label: "유료관리", evidence: "서비스계약·청구주체·시작일" },
    { event: "addon_opportunity_created", label: "추가서비스 기회", evidence: "현장문제·고객요구·기회ID" },
    { event: "quote_requested", label: "견적요청", evidence: "고객의 견적요청과 범위·사진·희망일" },
    { event: "quote_approved", label: "견적승인", evidence: "고객 승인 견적서·책임주체·일정" },
    { event: "work_completed", label: "작업완료", evidence: "완료사진·검수결과·하자처리 기준" },
    { event: "addon_revenue_booked", label: "추가매출", evidence: "작업완료 후 발행·입금 또는 미수금 매출기록" },
  ];

  const pocBaseline = {
    description: "대표의 직접연락 초기 표본",
    sampleContactCount: 50,
    listingIntakeCountRange: [5, 6],
    listingIntakeRateRange: [0.10, 0.12],
    metricName: "매물접수 반응률",
    conversionFrom: "접촉시도",
    conversionTo: "매물접수",
    mustNotCallThis: "임대차계약률",
    caveat: "전체 응답 수와 계약 수를 별도로 집계하지 않았으므로 응답률·계약률 기준값으로 사용하지 않는다.",
    note: "50건 접촉 → 매물접수 5~6건(10~12%). 이는 매물접수 반응률이며 임대차계약률이 아니다.",
  };

  return Object.freeze({
    doctrine,
    scripts: Object.freeze(scripts),
    checklists: Object.freeze(checklists),
    catalogs: Object.freeze(catalogs),
    funnelEvents: Object.freeze(funnelEvents),
    pocBaseline: Object.freeze(pocBaseline),
  });
});
