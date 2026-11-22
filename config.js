// Firebase 콘솔 → 프로젝트 설정 → 내 앱(웹) 에서 복사한 값으로 바꿔 주세요.
// 값을 채우지 않으면 "로컬 모드"로 동작합니다(이 브라우저에만 저장, 공유 안 됨).
export const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "000000000000",
  appId: "1:000000000000:web:0000000000000000"
};

// 그룹 코드: 같은 코드를 쓰는 사람끼리 캘린더를 공유합니다.
// 주소 뒤에 ?g=코드 를 붙이면 그 그룹으로 들어갑니다. (예: .../?g=seoul-2026)
export const DEFAULT_GROUP = "default";
