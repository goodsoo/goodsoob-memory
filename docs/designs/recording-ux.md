# 녹음 탭 UX 개편 구현 스펙

## A. 화면 구조와 상태

### 영역 (위에서 아래로)

```
PageHeaderBar "녹음"                                   (지금 그대로)
┌ 스크롤 영역 (data-testid=recording-scroll, position:relative, FindBar 기준점)
│ 머리: [제목 h3]                        [주 버튼 1개] [보조 버튼] [⋯]
│       날짜·시각 · 길이 · base(mono, 작게, muted)
│       상태 줄 (caption --sub, 상자 없이 글자만. 처리 중이면 Spinner xs + 글자)
│ 참석자 N명  ● 이름 ● 이름                  (TranscriptTurns 안의 줄 그대로)
│ 문단들     ← 지금 재생 중인 문단 = 행 배경 --surface, radius-8, 테두리 없음
│ (있을 때만) "본문에서 위치를 못 찾은 고칠 곳 N개" 접힌 행
└
┌ 재생 막대 (shrink-0, position:sticky; bottom:0, 배경 --surface, 테두리·그림자 없음)
│ [↺5] [▶/❚❚] [↻5]  1:23 / 9:07  ━━━●━━━━━━━  [1배 ▾]  [현재 위치로]  [⌨]
└
```

- **제목**: `recordingSubtitle(entry)`가 있으면 그것, 없으면 `recordingWhen(entry)`. 둘째 줄은 `recordingWhen · formatDuration · base`.
- **다음 할 일 카드(Card)는 없앱니다.** 지금 카드에 있던 상태 안내는 "상태 줄" 글자로, 버튼은 머리 오른쪽으로 옮깁니다. 취향 규칙(상태는 상자 없이 글자로, 화면당 primary 1개)을 따른 것입니다.
- **재생 막대**: `entry.hasM4a`일 때만 나옵니다. 재생 위치 막대는 DS에 해당 부품이 없어(F·D 참고) 당분간 native `<input type="range">`에 `accentColor: var(--btn-primary)`를 씁니다.
- **"현재 위치로" 버튼**: 사용자가 스크롤로 따라가기를 끊었을 때만 막대 안에 나옵니다. 떠 있는 알약 버튼은 쓰지 않습니다.
- **따라 스크롤**
  - 재생 중인 문단이 바뀌었는데 그 문단이 스크롤 영역 가운데 20~80% 구간 밖에 있으면 `scrollIntoView({block:"center"})`로 옮깁니다. reduced-motion이면 `auto`, 아니면 `smooth`.
  - 스크롤 영역에서 `wheel`·`touchmove`·PageUp/PageDown/Home/End가 일어나면 `following=false`가 됩니다.
  - 시각 클릭, ↑/↓, "현재 위치로"를 누르면 `following=true`로 돌아갑니다.
  - 문단을 고치는 중(document.activeElement가 본문 textarea)일 때는 따라가기를 잠시 멈춥니다. `following` 값 자체는 바꾸지 않습니다.
- **고치기와 듣기**: 문단 글자를 누르면 그 자리에서 고칩니다(지금 동작 그대로). 시각을 누르면 그 위치로 이동해 재생하고 따라가기를 켭니다.

### 상태별 화면

| 상태 (destination / pipeline) | 상태 줄 | 주 버튼 / 보조 버튼 | 본문 |
|---|---|---|---|
| undecided / waiting | 자동 받아쓰기를 기다리는 중입니다. | 없음 | 없음 |
| undecided / raw (받아쓰기만 있음) | 자동 받아쓰기 상태입니다. 말한 사람을 나누면 문단별로 듣고 고칠 수 있습니다. | primary **말한 사람 나누기** (나누기 창 열림) | 평문, 읽기만. 시각 없음(F-Q1) |
| undecided / processing | Spinner + `stepLabel(job.step)` + "다른 녹음으로 넘어가도 계속 진행됩니다." | 없음 (⋯의 삭제는 꺼짐) | 읽기만 |
| undecided / error | DS `Alert variant="down"` 하나(원인과 해결). 상태 줄 대신 들어갑니다 | Alert action: 실패한 부분만 다시 실행 / 다시 실행 (말한 사람 나누기 오류면 나누기 창) | 마지막 작업 파일, 읽기만 |
| undecided / correction (나누기 끝, 후보 없음) | 문단을 눌러 고치고, 시각을 눌러 그 부분부터 듣습니다. | primary **메모로 보내기** / ghost **고칠 곳 찾기** (title: 본문이 Claude 로 전송됩니다.) | 고칠 수 있음 |
| undecided / review (후보 있음) | 고칠 곳 N개 남음. 밑줄을 눌러 바꾸거나 그대로 둡니다. (N = 위치를 찾은 것만) | primary **메모로 보내기** / secondary **다음 고칠 곳** | 고칠 수 있음, 후보에 밑줄. 맨 아래에 위치 못 찾은 항목 접힘 |
| undecided / corrected 또는 보낼 수 있는 textOnly | 고치기를 마쳤습니다. 보낼 메모를 고릅니다. 연결이 끊긴 기록이 있으면 Alert info + "연결 복구" | primary **메모로 보내기** | 고칠 수 있음 (지금 서버도 corrected 저장을 허용) |
| textOnly (보낼 수 없음) | 녹음 파일 없이 자동 받아쓰기만 남아 고치거나 보낼 수 없습니다. 필요 없으면 오른쪽 위 메뉴에서 삭제하세요. | 없음 | 재생 막대 없음 |
| linked / moveIncomplete (보냄) | '{제목}' 메모로 보냈습니다. 고칠 곳은 메모의 음성 기록에서 고칩니다. (moveIncomplete면 " 메모로 옮기는 중입니다." 추가) | primary **메모 열기** | 없음 (기록이 메모로 옮겨감). 재생 막대는 남음 |
| trash | 이 녹음을 보낸 메모 '{t}' 가 휴지통에 있습니다. 메모를 복원하면 음성 기록도 함께 돌아옵니다. | secondary **메모 복원** | 없음 |
| transcriptMissing | 보냈던 메모가 휴지통에서 비워져 음성 기록도 함께 지워졌습니다. 필요 없으면 오른쪽 위 메뉴에서 삭제하세요. | 없음 | 없음 |
| 실행 중 오디오 404 / 503 / 실패 | 재생 막대 자리에 문장 + (404가 아니면) "다시 시도" 버튼 | | 본문은 그대로 |

**⋯ 메뉴 (DS Dropdown)**
- 말한 사람 다시 나누기: 조건은 지금 `canRediarize`와 같습니다. 나누기 창을 "다시 나누면 지금까지 고친 내용과 찾은 고칠 곳이 사라집니다." 경고와 함께 엽니다.
- 고칠 곳 다시 찾기: correction 또는 review일 때만.
- 삭제: `tone:"danger"`.

### "교정 완료"와 "메모로 보내기" 합치기 (마찰 최소화)

"교정 완료" 버튼은 없앱니다. **메모로 보내기** 하나로 합칩니다.

1. 버튼을 누르면 `SendToMemoDialog`가 열립니다.
2. 창 위쪽에 고정 안내가 있습니다: "보내면 음성 기록이 이 메모로 옮겨집니다. 그 뒤에는 녹음 화면에서 고칠 수 없고 메모의 음성 기록에서 고칩니다." 남은 고칠 곳이 있으면 "남은 고칠 곳 N개는 그대로 둡니다."를 덧붙입니다.
3. 메모 행을 누르면 바로 보냅니다. 창 자체가 확인 단계라 ConfirmDialog를 따로 띄우지 않습니다.
4. 실행 순서: `work.flush()` → (pipeline이 corrected·textOnly가 아니면) `completeRecording` → `link`.
5. complete는 성공했는데 link가 실패하면, 녹음이 corrected 상태로 바뀌고 창은 열린 채 에러 토스트를 띄웁니다. 그대로 다시 시도하면 됩니다.

서버 변경은 없습니다. 남은 후보는 complete가 review.json을 지우므로 "그대로 둠"과 같은 결과가 됩니다.

### 위치를 못 찾은 후보

- 본문 맨 아래에 DS `ListGroup` 안 `ListRow` 하나를 둡니다: label "본문에서 위치를 못 찾은 고칠 곳", value "N개", 오른쪽에 chevron. 행 전체가 펼침/접힘 버튼이고 기본은 접힘입니다.
- 펼치면 항목마다 `ListRow`(label `orig → sugg`, value "그대로 두기")가 나옵니다.
- 상태 줄 개수에는 넣지 않습니다. 보내면 자동으로 버려집니다.

## B. 용어 바꾸기 표 (예전 → 새 문구)

**동사형 라벨 해석 기준**: 한자어 "~하다" 동사는 명사로 씁니다(삭제·저장·연결·복원). 명사가 없는 고유어 동사는 macOS 한국어 관례대로 "~기"를 허용합니다(나누기·보내기·찾기·고치기·바꾸기·두기). CLAUDE.md가 금지하는 "~하기"(삭제하기)는 쓰지 않습니다.

**고정 용어**
- 전사(본) → 음성 기록 (메모 탭 이름과 맞춤)
- 초벌 전사 → 자동 받아쓰기
- 화자 → 말한 사람 (데이터 이름 `화자0`은 그대로)

| 파일:줄 | 예전 | 새 문구 |
|---|---|---|
| `src/components/recordings/recordingLabels.ts`:56 | 전사본이 이미 다른 메모로 옮겨졌습니다. 먼저 그 메모에서 연결을 해제하세요. | 음성 기록이 이미 다른 메모로 옮겨졌습니다. 그 메모에서 녹음 연결을 먼저 해제하세요. |
| recordingLabels.ts:58 | 아직 전사본이 없습니다. 전사가 끝난 뒤 다시 시도하세요. | 아직 받아쓰기가 끝나지 않았습니다. 끝난 뒤 다시 시도하세요. |
| recordingLabels.ts (추가) | (서버 문구 그대로 노출) `rawReadonly` | 말한 사람을 나누기 전에는 고칠 수 없습니다. 말한 사람 나누기를 먼저 실행하세요. |
| 〃 추가 | `linked` | 이미 메모로 보낸 녹음입니다. 메모의 음성 기록에서 고치세요. |
| 〃 추가 | `conflict` | 다른 곳에서 내용이 바뀌었습니다. 새로 불러온 뒤 다시 고치세요. |
| 〃 추가 | `notCorrected` | 아직 메모로 보낼 수 없습니다. 말한 사람을 나눈 뒤 다시 시도하세요. |
| 〃 추가 | `syncPending` / `noAudio` | 녹음 파일을 아직 iCloud 에서 받는 중입니다. 잠시 후 다시 시도하세요. / 녹음 파일이 없습니다. 파일이 옮겨졌거나 삭제됐는지 확인하세요. |
| `src/lib/recordings/processing.ts`:14 | 교정 후보 만드는 중 (a/b) | 고칠 곳 찾는 중 (a/b) |
| processing.ts:17 | 대기 중 | 순서를 기다리는 중 |
| :19 | 오디오 변환 중 | 녹음 파일 준비 중 |
| :21 | 화자 나누는 중 | 말한 사람 나누는 중 |
| :23 | 화자와 전사 합치는 중 | 나눈 결과를 글에 맞추는 중 |
| :25 | 표기 정리하는 중 | 표기 정리 중 |
| :27 | 교정 위치 찾는 중 | 고칠 곳 위치 표시 중 |
| :56, :58 | 화자 수를 1~10 사이 정수로… / 화자 수는 1~10 사이로… | 인원 수는 1~10 사이 숫자로 입력하거나 비워 두세요. |
| :74 | 이름은 앞 화자부터 차례로 입력하세요. 비워둘 화자는 뒤쪽에 두세요. | 이름은 첫 번째 사람부터 차례로 입력하세요. 비워 둘 칸은 뒤쪽에 두세요. |
| :77 | 화자 이름은 40자 이내로 입력하세요. | 이름은 40자 이내로 입력하세요. |
| :87 badSpeakers | 화자 수가 올바르지 않습니다… | 인원 수가 올바르지 않습니다. 1~10 사이 숫자로 입력하거나 비워 두세요. |
| :89 badNames | 화자 이름이 올바르지 않습니다… | 이름이 올바르지 않습니다. 40자 이내로, 인원 수보다 많지 않게 입력하세요. |
| :91 notPro | 이 기능은 Pro 맥에서만… | 이 작업은 Pro 맥에서만 실행됩니다. Pro 맥의 앱에서 다시 시도하세요. |
| :95 notTranscribed | 초벌 전사가 아직 끝나지 않았습니다… | 자동 받아쓰기가 아직 끝나지 않았습니다. 끝난 뒤 다시 시도하세요. |
| :97 notDiarized | 화자분리가 아직 없습니다. 화자분리를 먼저 실행하세요. | 말한 사람을 아직 나누지 않았습니다. 말한 사람 나누기를 먼저 실행하세요. |
| :103 noPartial | …교정 후보 만들기를 전체 재실행하세요. | 다시 실행할 실패 부분이 없습니다. 고칠 곳 찾기를 처음부터 다시 실행하세요. |
| :114 interrupted | 처리가 중단되었습니다. 서버가 재시작된 것 같습니다. 아래 버튼으로 다시 실행하세요. | 작업이 중단되었습니다. 서버가 재시작된 것 같습니다. 다시 실행을 누르세요. |
| :116 | `${error} 원인을 확인한 뒤 아래 버튼으로 다시 실행하세요.` | `${error} 원인을 확인한 뒤 다시 실행을 누르세요.` |
| :122 | N번 부분의 교정 후보를 만들지 못했습니다. | N번 부분은 고칠 곳 찾기에 실패했습니다. |
| `src/lib/recordings/inbox.ts`:33 | 휴지통 메모에 연결됨 | 메모가 휴지통에 있음 |
| inbox.ts:34 | 연결됨 | 메모로 보냄 |
| :35 | 전사본 없음 | 기록 없음 |
| :38 | 전사 대기 | 받아쓰는 중 |
| :40 | 화자 나누기 | 자동 받아쓰기 |
| :42 | 화자 나누는 중 / 고칠 곳 찾는 중 | 말한 사람 나누는 중 / 고칠 곳 찾는 중 |
| :44 | 오류 | 처리 실패 |
| :47 | 고칠 곳 N개 / 고칠 곳 확인 | 고칠 곳 N개 / 고칠 곳 불러오는 중 |
| :50 | 듣고 고치기 | 고치는 중 |
| :52, :54 | 연결 대기 / 텍스트만 | 보낼 준비 됨 / 글만 있음 |
| `src/components/recordings/RecordingsSidePanel.tsx`:89 | 처리할 것 중 30초 미만 녹음을 모두 고릅니다 | 새 녹음 중 30초 미만을 모두 고릅니다 |
| RecordingsSidePanel.tsx:105 | 처리할 것 | 새 녹음 |
| :113 | 처리할 녹음이 없습니다 | 새 녹음이 없습니다 |
| :132 | 끝난 것 | 정리 끝 |
| :233 | · 동기화 대기 | · iCloud 받는 중 |
| `src/hooks/useWorkingTranscript.ts`:60 | 다른 곳에서 전사본이 바뀌어 새로 불러왔습니다… | 다른 곳에서 내용이 바뀌어 새로 불러왔습니다. 방금 고친 곳을 다시 고치세요. |
| useWorkingTranscript.ts:64 | 전사본을 저장하지 못했습니다. | 고친 내용을 저장하지 못했습니다. … |
| `src/pages/TodayPage.tsx`:174 | 처리할 녹음 N개 | 새 녹음 N개 |
| `src/pages/RecordingsPage.tsx`:67 | 녹음 이사를 마무리하지 못했습니다. | 메모로 옮기던 기록을 마무리하지 못했습니다. |
| RecordingsPage.tsx:130–131 | 처리할 녹음이 없습니다 / 새 녹음은 전사가 끝나면… 왼쪽 끝난 것에서… | 새 녹음이 없습니다 / 음성 메모가 받아쓰기를 마치면 여기에 나타납니다. 지난 녹음은 왼쪽 정리 끝에서 엽니다. |
| :192 | 결정을 저장하지 못했습니다. | 선택을 저장하지 못했습니다. |
| :213 | 구절 위치가 바뀌어 수락하지 못했습니다. 직접 고치세요. | 그 부분이 바뀌어 제안대로 바꾸지 못했습니다. 직접 고치세요. |
| :250 | 교정을 완료했습니다. 이제 메모에 연결할 수 있습니다. | (삭제. 보내기와 합침) |
| :258 | 화자 다시 나누기 | 말한 사람 다시 나누기 |
| :326 aria | 전사 | 음성 기록 |
| :329 | 초벌 전사입니다. 화자분리 후 고칠 수 있습니다. | (raw 상태 줄로 옮김, A 표) |
| :358 | 전사본을 읽지 못했습니다. | 음성 기록을 불러오지 못했습니다. |
| `src/components/recordings/NextStepCard.tsx`:32–34 | 이 메모에 연결합니다. / 연결하면 전사본이… | 보내기 창 고정 안내 (A 참고) |
| NextStepCard.tsx:67, :70 | 메모에 연결됨 / 전사본 이사를 마무리하는 중입니다. | 상태 줄 "'{제목}' 메모로 보냈습니다…" / 메모로 옮기는 중입니다. |
| :85–87 | 전사본 없음 / 연결됐던 메모가…전사본도… | (A 표 transcriptMissing 문구) |
| :97 | …고친 내용과 고칠 곳 후보가 사라집니다. | 다시 나누면 지금까지 고친 내용과 찾은 고칠 곳이 사라집니다. |
| :99, :116 | 화자분리 (제출 버튼) | 나누기 |
| :107–109 | 전사 대기 / 자동 전사를 기다리는 중입니다. | 자동 받아쓰기를 기다리는 중입니다. |
| :115 | 화자 나누기 | 말한 사람 나누기 (주 버튼과 창 제목) |
| :145–147 | 듣고 고치기 / 발화를 눌러 고치고… 교정 완료를 누르세요. | 문단을 눌러 고치고, 시각을 눌러 그 부분부터 듣습니다. |
| :151, :176 | 교정 완료 | 메모로 보내기 |
| :156, :425 | Claude 로 고칠 곳 찾기를 누르면 전사 내용이… / 전사 내용이 Claude 로 전송됩니다. | 본문이 Claude 로 전송됩니다. (버튼 title + 오류 Alert 아래 caption) |
| :164 | 표시된 구절을 눌러 수락하거나… | 밑줄을 눌러 바꾸거나 그대로 둡니다. 메모로 보내면 남은 곳은 그대로 둡니다. |
| :188–190 | 텍스트만 / …초벌 전사만 남아 고치거나 연결할 수 없습니다… | (A 표 textOnly 문구) |
| :222 | 위치를 찾지 못한 후보 N개 | 본문에서 위치를 못 찾은 고칠 곳 (value N개) |
| :230 | (원문 없음) | (내용 없음) |
| :234–235 | 원문 유지 / 이 후보를 넘기고 원문을 유지합니다 | 그대로 두기 / 이 항목을 고치지 않고 넘깁니다 |
| :249–251 | 휴지통 메모에 연결됨 / …전사본도 함께 돌아옵니다. | (A 표 trash 문구) |
| :307 | 화자분리를 시작했습니다. | 말한 사람 나누기를 시작했습니다. |
| :338 | 화자 N 이름 | N번째 사람 이름 (선택) |
| :349 placeholder | 이름 (선택) | 이름을 입력하세요 |
| :357–359 | 인원 수를 비우면 목소리로… 화자분리는 이 맥에서 실행됩니다. | 비우면 목소리로 인원을 판단합니다. 10명이 넘으면 인원 수를 입력하세요. 이 맥에서 처리하며 외부로 보내지 않습니다. {estimate} / 이름은 첫 번째 사람부터 차례로 입력합니다. |
| :416 | Claude 로 고칠 곳 찾기 | 고칠 곳 찾기 |
| :469 | '{n}' 메모에 연결했습니다. / 메모에 연결했습니다. | '{n}' 메모로 보냈습니다. / 메모로 보냈습니다. |
| :480 | 메모에 연결 | 메모로 보내기 (창 제목) |
| :484, :492 | 연결 정보가 없는 전사본 섹션이 있습니다 / 연결 정보를 복구했습니다. | 연결이 끊긴 음성 기록이 있습니다 / 연결을 복구했습니다. |
| :508 | 같은 날짜 메모가 없습니다. 다른 메모를 찾거나 새 메모로 만드세요. | 같은 날 메모가 없습니다. 아래에서 메모를 찾거나 새 메모를 만드세요. |
| :514, :517 | 다른 메모 찾기 / 새 메모로 만들기 | (검색칸 항상 보임) / 새 메모 |
| :552 | 만들기 | 새 메모로 보내기 |
| :561 | 연결 / 취소 | (삭제. 창이 확인 역할) |
| `src/components/recordings/ReviewDetail.tsx`:6 | 오인식 | 잘못 들은 말 |
| ReviewDetail.tsx:8 | 화자 오귀속 | 말한 사람이 틀림 |
| :61 / :65 / :68 | 수락 / 원문 유지 / 직접 고침 | 바꾸기 / 그대로 두기 / 직접 고치기 |
| 〃 추가 (C 종류만) | — | 문단 위 이름을 눌러 말한 사람을 바꿉니다. |
| `src/components/meetings/TranscriptTurns.tsx`:278 title | 클릭해 고치기 | 눌러서 고칩니다 |
| TranscriptTurns.tsx:387 | 새 화자 (X) | 새 사람 (X) |
| :418 | 다른 화자 이름을 입력하면 합쳐집니다. | 다른 사람 이름을 입력하면 한 사람으로 합칩니다. |
| :436 title | 이 화자 이름 전체 변경. 다른 화자 이름으로 바꾸면 합쳐집니다 | 이 사람 이름을 모두 바꿉니다. 다른 사람 이름으로 바꾸면 합칩니다 |
| :535 title | 이 발화의 화자 변경 | 이 문단의 말한 사람을 바꿉니다 |
| `src/components/recordings/AudioPlayer.tsx`:71 | 녹음 파일이 아직 이 맥으로 동기화되지 않았습니다… | 녹음 파일을 아직 iCloud 에서 받는 중입니다. 잠시 후 다시 시도하세요. |
| 새 PlaybackBar (aria / title) | — | 재생 · 일시정지 · 5초 뒤로 · 5초 앞으로 · 재생 속도 · 현재 위치로 · 단축키. 배속 항목 "0.75배 … 2배" |

**그대로 두는 것**
- TranscriptTurns의 aria 라벨(`… 발화 편집`, `… 부터 듣기`, `… 이름 변경`)과 "참석자 N명": 테스트가 의존하고 메모 탭과도 같이 씁니다.
- 지울 때 문구(useRecordingDelete.tsx:7,:25,:29,:33,:41), "30초 미만 선택", "메모 열기", "메모 복원", "다시 시도", "다시 실행", "실패한 부분만 다시 실행", "연결 복구".
- 메모 쪽 SectionAudio 문구: 이번 범위 밖입니다.

## C. 단축키

**두는 곳**
- 순수 해석 함수: `src/lib/recordings/shortcuts.ts`
  - `resolveShortcut(ev, ctx): RecordingShortcutAction | null`
  - `ctx = { inTextInput, inOverlay }`
  - 같은 파일에 도움말 목록 `RECORDING_SHORTCUTS`
- window keydown 등록: `src/hooks/useRecordingShortcuts.ts`
  - MeetingForm:628–666처럼 ref로 최신 핸들러를 넘기고 deps 없이 한 번만 등록합니다.
  - `RecordingDetail`이 떠 있는 동안만 켜집니다. 그래서 녹음 탭 밖이나 메모장의 ⌘F·⌘Z와 충돌하지 않습니다.

**공통 판정 규칙**
- 글자 키는 반드시 `e.code`로 판정합니다(`KeyK`, `Comma`, `Slash`). 한글 자판에서는 `e.key`가 'ㅏ' 같은 자모로 바뀌기 때문입니다.
- 꾸밈키 없는 키(Space·화살표·글자)는 아래 경우 무시합니다:
  - `inTextInput`: INPUT·TEXTAREA·SELECT·contentEditable
  - `e.isComposing`
  - meta·ctrl이 눌렸을 때 (그래서 App의 ⌘1~9, ⌘P, ⌘\ 는 그대로 동작)
  - `inOverlay`: `target.closest('[role="dialog"],[role="menu"],[role="listbox"]')`. 열린 Modal, 후보 Popover, Dropdown 안에서는 Space가 원래대로 버튼을 누릅니다.
- ⌥ 조합은 입력칸 안에서도 동작하고 `isComposing`이어도 실행합니다(⌥는 한글 조합에 들어가지 않음).

| 키 | 동작 | 입력칸 안 |
|---|---|---|
| Space | 재생 / 일시정지 (preventDefault: 버튼 눌림·페이지 스크롤 막음) | ✗ |
| ← / → | 5초 뒤로 / 앞으로 | ✗ |
| ↑ / ↓ | 이전 / 다음 문단 시작으로 이동 + 따라가기 켬. 재생 상태는 유지. 이전: 현재 문단 시작에서 1.5초가 지났으면 현재 문단 시작으로, 아니면 그 앞 문단으로 | ✗ |
| **⌥K** | 재생 / 일시정지 | **✓** (고치는 중에 쓰는 조합) |
| ⌥J / ⌥L | 5초 뒤로 / 앞으로 | ✓ |
| ⇧, / ⇧. (`<` `>`) | 배속 한 단계 내리기 / 올리기. 단계 [0.75, 1, 1.25, 1.5, 1.75, 2], localStorage `goodsoob:recordingRate` | ✗ |
| N / ⇧N | 다음 / 이전 고칠 곳 (review 상태만, 이 경로로 연 후보는 결정 뒤 자동으로 다음 후보) | ✗ |
| ⌘F | 본문 찾기 열기 (입력칸 안에서도) | ✓ |
| ⌘Z / ⌘⇧Z | 되돌리기 / 다시 실행 (`work.undo/redo`) | ✗ (고치는 textarea 안은 브라우저 기본 undo) |
| ? (⇧ + `Slash`) | 단축키 도움말 | ✗ |
| Esc | 고치는 중이면 취소(지금 동작), 찾기 바가 열려 있으면 닫기 | — |

**⌥K를 고른 이유**
- ⌥Space는 Alfred·Raycast 기본 단축키라 뺐습니다.
- ⌃Space는 macOS 입력 소스 전환이라 뺐습니다.
- ⇧Space는 한/영 전환으로 설정된 경우가 있어 뺐습니다.
- ⌘↩는 문단 확정과 겹쳐 뺐습니다.
- ⌥J/K/L은 YouTube JKL 기억법을 그대로 쓰고, 앱의 기존 ⌥ 조합(⌥Tab 메모 서브탭, ⌥↑↓ 줄 이동)과도 안 겹칩니다.

**보너스**: `useAudioPlayback`에 `navigator.mediaSession` 핸들러(play·pause·seekbackward·seekforward)를 달면 키보드 미디어키와 AirPods 탭이 어디서든 먹습니다.

**도움말 진입**: `?` 키 또는 재생 막대 맨 오른쪽 Keyboard 아이콘 버튼(title "단축키").
- 창: DS `Modal size="sm"`, 행마다 DS `Kbd`(`../common/Kbd` 어댑터).
- 설정 > 단축키(`src/components/settings/ShortcutsSection.tsx`)의 GROUPS에도 "녹음" 묶음을 `RECORDING_SHORTCUTS`에서 가져와 추가합니다.

## D. 파일별 계획

### 새로 만드는 순수 모듈

**`src/lib/recordings/playback.ts`**
- `RATES`
- `nextRate(cur, dir: 1 | -1)`
- `activeTurnAt(starts: readonly number[], sec): number` (-1 = 첫 문단 전, 이분 탐색)
- `prevTurnTarget(starts, sec, active): number` (초)
- `nextTurnTarget(starts, active): number | null`
- `formatPlayTime(sec)`: "m:ss" 또는 "h:mm:ss"

**`src/lib/recordings/shortcuts.ts`**: 위 C의 resolver와 `RECORDING_SHORTCUTS: {keys: string[]; label: string; note?: string}[]`.

**`src/lib/recordings/find.ts`**
- `findInTranscript(parsed, q, caseSensitive): {turnIndex, start, end}[]`
- `replaceOne(parsed, match, r)`
- `replaceAll(parsed, q, r, cs): ParsedTranscript` (`updateTurnText` 기반)

**`src/lib/recordings/textHistory.ts`**: 순수 undo 스택 `{past, future}`. `push(prev)`, `undo(cur)`, `redo(cur)`, 상한 100.

### 바꾸는 것

**`src/hooks/useWorkingTranscript.ts`**
- `setText`마다 이전 text를 push합니다.
- `undo(): boolean`, `redo(): boolean`, `canUndo`, `canRedo`를 추가합니다. 둘 다 setText처럼 저장을 예약합니다.
- 서버 값으로 다시 덮을 때(conflict refetch)는 스택을 비웁니다.
- 알려진 한계: 후보를 "바꾸기"한 뒤 되돌려도 review.json 결정은 그대로 남습니다. 보내면 지워지니 받아들입니다.

**`src/components/meetings/TranscriptTurns.tsx`** (추가만, 기본값 유지 → 메모 탭 영향 없음)
- 새 prop `activeTurnIndex?: number | null`. 해당 턴 row에 `data-active="true"`와 배경 `--surface`, radius-8, 좌우 inset 패딩을 줍니다. 패딩은 모든 row에 똑같이 줘서 활성 문단이 바뀔 때 글자가 밀리지 않게 합니다.
- `highlightStyle(kind)`을 바꿉니다:
  - A: `text-decoration: underline wavy var(--warn)`
  - B: `underline dotted var(--sub)`
  - C: `underline var(--down)`
  - 공통: `text-underline-offset: 3px`, 배경 없음
  - `find`: 배경 `--warn-soft`
  - `find-active`: 배경 `--warn-soft` + `outline 1px var(--warn-line)`
- B 표의 문구를 바꿉니다.
- `MeetingForm.tsx:1479`는 손대지 않습니다. 하이라이트를 넘기지 않으므로 바뀌는 건 문구뿐입니다.

**`src/components/recordings/ReviewDetail.tsx`**: props는 그대로. 라벨과 C 안내만 바꿉니다.

**문구만 바꾸는 파일**: `recordingLabels.ts`(코드 매핑 추가), `inbox.ts`, `processing.ts`, `RecordingsSidePanel.tsx`, `TodayPage.tsx`:174.

**`src/pages/RecordingsPage.tsx`**
- 목록, 자동 선택, 이사 복구, 다음 녹음으로 이동만 남깁니다.
- 바깥 div는 `relative`로 바꿉니다(FindBar 기준점).
- `RecordingDetail`은 파일을 분리합니다.
- 자동 선택은 기존 `todoOrder` 순서를 유지합니다.

### 새 컴포넌트와 훅

**`src/hooks/useAudioPlayback.ts`** (`AudioPlayer.tsx`의 404/503 진단·다시 시도 로직을 옮김)
- 반환값:
  - 상태: `{ audioRef, audioProps, state: "ready" | "syncPending" | "missing" | "failed", playing, currentSec, durationSec, rate }`
  - 조작: `toggle(), seek(sec, {play?: boolean}), skip(d), setRate(r), cycleRate(dir), retry() }`
- 진행 표시는 `timeupdate` 이벤트로 하고, 재생 중에는 rAF로 부드럽게 갱신합니다.
- metadata가 오기 전 seek는 보류했다가 적용합니다(AudioPlayer:25–37 방식).

**`src/hooks/useFollowPlayback.ts`**: `({scrollEl, activeIndex, suspended}) → {following, resume}`. 규칙은 A 참고.

**`src/hooks/useRecordingShortcuts.ts`**: C 참고.

**`src/components/recordings/PlaybackBar.tsx`**: props `{player, following, onResumeFollow, onOpenHelp}`. 숨긴 `<audio>`도 여기서 렌더합니다.
- DS `Button`: icon-only. RotateCcw / Play·Pause / RotateCw / Keyboard. "현재 위치로"는 ghost sm.
- DS `Dropdown`: 배속. items에 `selected`, 트리거는 Button ghost sm "1.25배".
- 위치 막대: native range (DS gap).
- 시간 표시: Text caption, tabular-nums.
- 오류 상태: 막대 대신 Text와 "다시 시도" Button.

**`src/components/recordings/RecordingDetail.tsx`**
- RecordingsPage:141–367을 옮기고 아래를 조립합니다.
- 상태: `seek` 대신 `player`. `activeTurnIndex = activeTurnAt(turn starts, player.currentSec)`.
- 찾기 상태 `{open, query, cs, active, replace}`:
  - 찾기 바가 열려 있으면 `highlights`를 find 하이라이트로 **바꿔 넣습니다**. 후보 밑줄과 겹치지 않게 하기 위해서입니다.
  - 기존 `../meetings/FindBar`를 수정 없이 씁니다. `canReplace = !readOnly`.
- 후보 수락·그대로 두기·직접 고치기 로직은 지금 :189–245 그대로 둡니다. 여기에 "N/다음 고칠 곳 경로로 열었으면 결정 뒤 자동으로 다음 후보" 플래그를 더합니다.

**`src/components/recordings/RecordingStatusLine.tsx`**: A 표대로 상태별 머리 오른쪽 버튼과 상태 줄을 그립니다.
- 순수 함수 `statusView(item, {remaining}) → {text, primary?, secondary?}`를 export해서 테스트합니다.
- DS `Button`, `Alert`(error·orphan), `Spinner`(xs), `Dropdown`(⋯ 메뉴).
- `CorrectionsAction` 로직(NextStepCard:378–429)을 여기로 옮깁니다.

**`src/components/recordings/SplitSpeakersDialog.tsx`**
- `DiarizeForm`(NextStepCard:274–374)을 옮깁니다.
- DS `Modal size="sm"` + `Modal.Header` / `Modal.Body` / `Modal.Footer`, `Field`, `Input`, `Button`.
- props: `{item, open, onClose, rediarize?: boolean}`.

**`src/components/recordings/SendToMemoDialog.tsx`**
- `LinkCard`·`MemoRows`(NextStepCard:435–593)를 옮깁니다.
- DS `Modal size="md"`, `ListGroup`/`ListRow`(같은 날 후보와 검색 결과), `SearchField`(항상 보임), `Button` ghost "새 메모"를 누르면 `Field`+`Input`(제목·폴더)과 primary "새 메모로 보내기"가 펼쳐집니다.
- props: `{item, open, onClose, remaining, flush: () => Promise<boolean>, onSent}`.
- complete → link 순서는 `useCompleteRecording().mutateAsync`를 씁니다. 이 훅이 mutateAsync를 노출하는지 확인하고, 없으면 같은 파일 소유 청크에서 `completeRecording` API를 직접 호출합니다.

**`src/components/recordings/UnmatchedCandidates.tsx`**: A의 "위치를 못 찾은 후보" 참고. DS `ListGroup`/`ListRow`.

**`src/components/recordings/ShortcutHelpDialog.tsx`**: DS `Modal size="sm"` + `Kbd`.

### 지우는 것
`src/components/recordings/NextStepCard.tsx`, `src/components/recordings/AudioPlayer.tsx`. 둘 다 RecordingsPage에서만 import합니다.

### DS에 없는 것 (ds-fix --report로 제보, 그동안 로컬 임시 처리)
1. **Slider / Scrubber**: 탐색 가능한 진행 막대. Meter는 표시 전용이라 대신 쓸 수 없습니다.
2. **(선택) MediaTransport 묶음**: 재생 막대 전체. 다른 앱에서 쓸 곳이 생기면 그때 올립니다.

Popover, Dropdown, Modal, ListRow, Kbd, Spinner, Alert, SearchField는 이미 있어 그대로 씁니다. 밑줄과 활성 문단 배경은 consumer 쪽 조립(mark·row 스타일, 토큰만 사용)으로 처리합니다.

## E. 구현 단위 (sonnet 에이전트 기준)

**청크 1: 용어, 순수 로직, 사이드바** (독립)
- 맡는 파일: `recordingLabels.ts`, `src/lib/recordings/inbox.ts`(+test), `processing.ts`(+test), `textHistory.ts`(+new test), `src/hooks/useWorkingTranscript.ts`, `RecordingsSidePanel.tsx`, `src/pages/TodayPage.tsx`
- 완료 기준:
  - B 표의 해당 줄이 전부 반영됨
  - `undo`/`redo`/`canUndo`/`canRedo`가 노출됨
  - inbox.test:60,62와 processing.test:15–18,76 기대값 갱신
  - recordingLabels 새 코드 매핑 테스트 추가
  - 문구에 em dash 없음

**청크 2: 문단 화면과 후보 팝오버** (독립)
- 맡는 파일: `TranscriptTurns.tsx`(+test), `ReviewDetail.tsx`(+test)
- 완료 기준:
  - `activeTurnIndex` prop이 들어가고 해당 row에만 `data-active`가 붙음
  - 밑줄 스타일과 find 계열 kind가 동작함
  - 문구 반영. TranscriptTurns.test에 active·find kind 케이스 추가
  - prop을 안 넘기는 기존 메모 탭 케이스(test:107–180)가 그대로 통과
  - ReviewDetail.test:31–34를 새 라벨로 갱신하고 C 안내 테스트 추가

**청크 3: 재생, 단축키, 찾기 엔진** (독립)
- 맡는 파일: `playback.ts`(+test), `shortcuts.ts`(+test), `find.ts`(+test), `useAudioPlayback.ts`, `useFollowPlayback.ts`, `useRecordingShortcuts.ts`, `PlaybackBar.tsx`(+test, 가짜 player 주입), `ShortcutHelpDialog.tsx`, `src/components/settings/ShortcutsSection.tsx`
- 완료 기준:
  - shortcuts.test가 아래를 확인함
    - textarea 안 Space → null
    - textarea 안 ⌥K → toggle
    - `code: "KeyK"`, `key: "˚"` 또는 자모일 때도 toggle
    - `isComposing` 상태의 Space → null
    - ⌘1 → null
    - ⇧Slash → help
    - inOverlay일 때 Space → null
  - playback.test가 경계값(첫 문단 전, 마지막 문단 뒤, 1.5초 규칙)을 확인함
  - find.test가 대소문자 구분과 replaceAll 왕복을 확인함
  - **AudioPlayer.tsx는 지우지 않음** (청크 4가 지움)

**청크 4: 통합** (청크 1·2·3 뒤에 순서대로)
- 맡는 파일: `src/pages/RecordingsPage.tsx`, 새 `RecordingDetail.tsx`, `RecordingStatusLine.tsx`(+test), `SplitSpeakersDialog.tsx`, `SendToMemoDialog.tsx`(+test), `UnmatchedCandidates.tsx`. 삭제: `NextStepCard.tsx`, `AudioPlayer.tsx`. 필요하면 `src/hooks/useRecordings.ts`.
- 완료 기준:
  - A 표의 상태 12가지가 statusView 테스트로 덮임
  - SendToMemoDialog 테스트: pipeline이 correction이면 complete → link 순서로 호출, corrected이면 complete 생략, link 실패 시 창이 열린 채 남음
  - 화면당 primary는 1개
  - 녹음 탭 밖에서는 단축키 리스너가 해제됨
  - 실제 7020에서 `bun run build` 후 확인: Space·⌥K·←→·↑↓·⌘F·⌘Z·? 동작, 따라 스크롤과 "현재 위치로", 한글 입력 상태에서 Space·⌥K
  - AFTER 스크린샷 3장(raw / review / 보내기 창)

**모든 청크 공통**: `bun run typecheck`, `bun run test:run` 통과. 청크 사이에 같은 파일을 둘이 고치지 않습니다. 청크 4만 1·2·3의 export에 의존합니다(위 D의 시그니처가 계약).

## F. 주인에게 물어볼 것 (최대 3개, 제 기본값 포함)

1. **받아쓰기만 있는(raw) 녹음도 시각, 따라 스크롤, 시각 클릭 듣기가 필요한가요?** 지금 tr.txt에는 시각이 없습니다.
   - 하려면 서버 `GET /transcript`가 raw일 때 tr.json에서 `segments` 필드를 더 내려줘야 하고, 화자 없는 턴 표시도 필요합니다.
   - **기본값**: 이번엔 안 합니다. raw는 평문으로 읽기만 하고, 주 버튼 "말한 사람 나누기"로 유도합니다.
2. **"교정 완료" 단계를 정말 없애도 될까요?** "고치기는 끝났지만 보낼 메모는 나중에 정함" 상태를 따로 남길 필요가 있는지입니다.
   - **기본값**: 없앱니다. 필요하면 ⋯ 메뉴에 "고치기 끝"을 숨겨 둘 수 있습니다.
3. **편집 중 재생 단축키를 ⌥K(그리고 ⌥J/⌥L)로 해도 될까요?** 이미 다른 데 쓰는 ⌥ 조합이 있는지 확인이 필요합니다.
   - **기본값**: ⌥K / ⌥J / ⌥L + 미디어키(mediaSession).

### Critical Files for Implementation
- /Users/angel/Library/Mobile Documents/com~apple~CloudDocs/projects/goodsoob-memory-recording-ux/src/pages/RecordingsPage.tsx
- /Users/angel/Library/Mobile Documents/com~apple~CloudDocs/projects/goodsoob-memory-recording-ux/src/components/recordings/NextStepCard.tsx
- /Users/angel/Library/Mobile Documents/com~apple~CloudDocs/projects/goodsoob-memory-recording-ux/src/components/meetings/TranscriptTurns.tsx
- /Users/angel/Library/Mobile Documents/com~apple~CloudDocs/projects/goodsoob-memory-recording-ux/src/components/recordings/AudioPlayer.tsx
- /Users/angel/Library/Mobile Documents/com~apple~CloudDocs/projects/goodsoob-memory-recording-ux/src/hooks/useWorkingTranscript.ts