(function (root) {
  "use strict";
  const video = (title, duration, url) => ({ title, duration, url });
  const weeks = [
    ["실무자에서 리더로 전환", [video("관리자인가, 해결사인가 1~4번 클립", "약 21분 40초", "https://gainge.com/contents/videos/5730"), video("R&R 과정", "12분 43초", "https://gainge.com/contents/videos/5537")], 34, "나는 무엇을 직접 하고, 무엇을 팀을 통해 해결해야 하는가", "내 역할에서 직접 할 일과 맡길 일을 나누고, 한 가지 위임 행동을 정합니다."],
    ["팀장은 무엇으로 성과를 만드는가", [video("관리자인가, 해결사인가 5~6번 클립", "22분 33초", "https://gainge.com/contents/videos/5730"), video("일을 잘 맡기는 방법", "4분 55초", "https://gainge.com/contents/videos/592"), video("권한 위임과 조직문화", "5분 53초", "https://gainge.com/contents/videos/6530")], 33, "팀장 책임 5개, 맡길 일 3개, 대표에게 보고할 일, 팀장 선에서 결정할 일", "현재 업무 하나를 골라 담당자·완료 기준·보고 시점을 적습니다."],
    ["성과관리의 기본", [video("성과관리란 무엇인가", "17분 36초", "https://gainge.com/contents/videos/4905"), video("왜 성과관리 방식인가", "19분 2초", "https://gainge.com/contents/videos/4905")], 37, "우리 팀이 만들어야 하는 결과, 바쁜 업무와 성과의 차이, 브링케어·브링FM 성과 한 문장", "반복 업무 하나를 결과 중심 문장으로 다시 씁니다."],
    ["올바른 성과관리와 리더의 역할", [video("올바른 성과관리 방법", "27분 33초", "https://gainge.com/contents/videos/4905"), video("리더의 역할", "17분 45초", "https://gainge.com/contents/videos/4905")], 45, "팀 목표 1개, 완료 기준, 팀장이 지원할 것, 팀원이 책임질 것", "이번 달 목표 하나의 측정 방법과 책임자를 정합니다."],
    ["실무자의 역할과 품질기준", [video("성과관리를 위한 실무자의 역할", "20분 2초", "https://gainge.com/contents/videos/4905"), video("CAC의 중요성", "14분 17초", "https://gainge.com/contents/videos/35")], 34, "팀원이 지킬 업무 원칙, 반복 실수, 체크리스트로 바꿀 업무 1개", "실제 반복 실수 한 가지를 예방 체크리스트로 바꿉니다."],
    ["위임한 업무를 방치하지 않는 방법", [video("CAC의 의미와 사례", "8분 15초", "https://gainge.com/contents/videos/35"), video("CAC 활용방법", "11분 33초", "https://gainge.com/contents/videos/35"), video("프로젝트 관리법", "13분 49초", "https://gainge.com/contents/videos/5533")], 34, "반복업무 체크리스트, 담당자·마감·완료 기준, 중간보고 시점, 문제 보고 기준", "현재 진행 중인 업무지시 한 건에 중간 확인 시점을 추가합니다."],
    ["고객 문제와 팀 목표", [video("목표에 몰입하는 조직을 만드는 3가지 방법 전반부", "약 30분", "https://gainge.com/contents/videos/4102")], 30, "브링케어 고객의 핵심 문제, 브링FM 고객의 핵심 문제, 이번 달 해결할 문제", "고객 불편 하나를 골라 문제·원인·첫 조치를 한 장으로 정리합니다."],
    ["KPI와 칸반보드", [video("목표에 몰입하는 조직을 만드는 3가지 방법 후반부", "약 30분", "https://gainge.com/contents/videos/4102")], 30, "결과지표 1~2개, 행동지표 2~3개, 하지 않을 일 3개, 주간 칸반보드", "지표 하나와 이를 움직일 주간 행동 하나를 정하고 보드에 등록합니다."],
    ["경청과 원온원", [video("1:1 면담 카드 활용법", "8분 29초", "https://gainge.com/contents/roadmap/185/videos/5536"), video("경청 노하우", "약 29분 34초", "https://gainge.com/contents/videos/70")], 38, "원온원 질문 5개와 어려움·지원·다음 행동을 확인하는 질문", "팀원과 10분 원온원을 진행하고 합의한 다음 행동을 기록합니다."],
    ["보고와 피드백", [video("일 잘하는 사람의 구두 보고 노하우", "26분", "https://gainge.com/contents/videos/3786"), video("R&R 과정 핵심 부분 복습", "약 8분", "https://gainge.com/contents/videos/5537")], 34, "브링 주간보고 표준형식", "실제 업무 한 건을 1분으로 보고하고 피드백을 반영해 다시 정리합니다."],
    ["동기 저하와 퇴사징후 ①", [video("직원들의 퇴사 시그널 전반부", "약 28분", "https://gainge.com/contents/videos/2681")], 28, "팀원 몰입 신호 점검표", "관찰한 사실과 추측을 구분해 지원이 필요한 신호 하나를 기록합니다."],
    ["동기 저하와 퇴사징후 ②", [video("직원들의 퇴사 시그널 후반부", "약 29분", "https://gainge.com/contents/videos/2681")], 29, "팀원 면담 시나리오", "성과 저하 또는 퇴사 고민 상황을 역할극으로 연습하고 질문을 다듬습니다."],
    ["채용과 인재판단 ①", [video("인재 선택의 기준", "15분 14초", "https://gainge.com/contents/videos/809"), video("인재 선별 실천법", "13분 11초", "https://gainge.com/contents/videos/809")], 28, "브링 팀원 인재상, 직무별 필수역량, 행동기준, 채용하지 않을 기준", "현재 필요한 역할 하나에 필수역량과 확인할 행동을 적습니다."],
    ["채용과 인재판단 ②", [video("경력 이직자의 니즈 분석", "7분 38초", "https://gainge.com/contents/videos/809"), video("연봉협상 전략", "13분 34초", "https://gainge.com/contents/videos/809"), video("후보자 커뮤니케이션", "11분 23초", "https://gainge.com/contents/videos/809")], 33, "면접 질문 10개, 후보자 평가표, 입사 후 첫 30일 기대성과, 면접 결과 보고서", "실제 채용 역할의 면접 질문 2개와 평가 기준을 만듭니다."],
    ["문제를 다르게 보는 팀장", [video("기회를 포착하는 비즈니스 프레이밍 전략 Part 1", "17분 43초", "https://gainge.com/contents/videos/301"), video("기회를 포착하는 비즈니스 프레이밍 전략 Part 2", "29분 7초", "https://gainge.com/contents/videos/301")], 47, "팀의 문제, 기존 질문, 새 질문, 다르게 해결할 가설", "브링 업무의 막힘 하나를 새 질문으로 바꾸고 검증할 작은 실험을 정합니다."],
    ["예비 팀장 최종발표", [], 0, "팀 목적, R&R, 위임 업무·지시서, 월간 목표·지표, 프로젝트 칸반, 체크리스트, 주간회의, 원온원, 30일 계획", "발표 결과를 바탕으로 30일 실행계획의 담당자·기한을 확정합니다."]
  ].map(([title, videos, videoMinutes, deliverable, application], index) => ({ week: index + 1, title, videos, videoMinutes, deliverable, application }));
  root.BringTeamTraining = Object.freeze({ title: "브링 예비 팀장 16주 교육", totalMinutes: 960, sessionMinutes: 60, weeks: Object.freeze(weeks) });
})(typeof globalThis !== "undefined" ? globalThis : this);
