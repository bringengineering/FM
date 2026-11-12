// 맥 브라우저 미리보기에서만 Pretendard 글꼴 파일을 불러온다(앱은 설치본에 들어 있음).
import * as Font from 'expo-font';
void Font.loadAsync({
  'Pretendard-Regular': require('../assets/fonts/Pretendard-Regular.otf'),
  'Pretendard-SemiBold': require('../assets/fonts/Pretendard-SemiBold.otf'),
  'Pretendard-Bold': require('../assets/fonts/Pretendard-Bold.otf'),
  'Pretendard-ExtraBold': require('../assets/fonts/Pretendard-ExtraBold.otf'),
}).catch(() => undefined);
