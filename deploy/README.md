# deploy — 로컬 서버 상주 (launchd)

V0.8 PWA 전환. Pro 맥이 정본 brain 을 소유한 Bun 서버(`server/index.ts`, 포트 7080)를 launchd 로 상주시킨다. growth(7060)·tower(7071) 와 동일 패턴 (`RunAtLoad`+`KeepAlive`, 로그인 시 자동 기동, 크래시 자동 재시작).

## ⚠️ 활성화 전 선결조건 (T0)

`launchctl load` 하기 **전에** 반드시:

1. **T0 완료** — `~/brain/.git`(467MB) 을 iCloud 밖 로컬로 분리 + `git gc`(loose 2445 → pack) + `gbrain-sync` 데몬과 앱 서버 writer 관계 정리. 안 하면 iCloud+git mtime-churn/부분sync 손상 재현.
2. plist 의 `VAULT_DIR` placeholder(`__SET_TO_BRAIN_PATH_AFTER_T0__`) 를 실제 brain 경로로 교체. 서버는 존재하지 않는 경로면 fast-fail 하므로, T0 전 실수로 load 해도 brain 을 건드리지 않는다.
3. `bun run build` 로 `dist/` 생성 (서버가 정적 서빙).

## 설치 (Pro 맥, T0 후)

```bash
cp deploy/com.goodsoob.memory.plist ~/Library/LaunchAgents/
# VAULT_DIR 를 실제 경로로 편집한 뒤:
launchctl load ~/Library/LaunchAgents/com.goodsoob.memory.plist
```

## air 맥 fallback (T9, v1 검증 대기)

air 는 평소 Pro 서버에 브라우저로 접속(자기 서버 안 띄움). **Pro 다운 시에만** 같은 plist 를 load 해 단일 writer 로 fallback. Pro 복귀 시 iCloud 가 md 를 재일치. 기동 전 Pro 서버 헬스체크로 살아있으면 fallback 거부(이중 writer 방지) — T9 에서 구현·검증.

## 외부 노출

tailscale serve 로 폰에서 접속(brain 은 극도로 사적 → 공개 도메인 노출 X, tailnet 소속 = 인증). growth 는 로컬전용, tower 는 cloudflared — 우리는 tailscale serve 로 신규 채택. 활성화는 별도 (defer).
