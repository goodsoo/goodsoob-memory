import {
  BookOpen,
  Download,
  KeyRound,
  Plug,
  RefreshCcw,
  Sparkles,
  Wand2,
  X,
} from "lucide-react";
import { ClipPromptButton } from "../common/ClipPromptButton";
import { Modal } from "../common/Modal";
import { Button } from "../common/Button";
import { Text } from "../common/Text";
import { Kbd as KbdCommon } from "../common/Kbd";
import { Spinner } from "../common/Spinner";
import {
  buildLegacyCardPrompt,
  buildPRGuidePrompt,
} from "../../lib/clipboardPrompt";
import { useVault } from "../../lib/vault/useVault";

type Props = {
  open: boolean;
  onClose: () => void;
  onFullSyncRun: () => void;
  fullSyncRunning: boolean;
  onOpenInstallGuide: () => void;
  onOpenAuthGuide: () => void;
};

// 포트폴리오 탭의 가이드북 — 동기화 방식, Claude 자동 채움, 프롬프트 도구.
// 사이드바 헤더의 BookOpen 아이콘 버튼이 열어줌. 메모장 TrashModal 패턴 동일.
export function PortfolioGuideModal({
  open,
  onClose,
  onFullSyncRun,
  fullSyncRunning,
  onOpenInstallGuide,
  onOpenAuthGuide,
}: Props) {
  const { vaultRoot } = useVault();

  return (
    <Modal open={open} onClose={onClose} size="lg" ariaLabel="포트폴리오 가이드북">
        {/* 헤더 */}
        <div
          className="flex shrink-0 items-center gap-2 px-5 py-3"
          style={{ borderBottom: "1px solid var(--line)" }}
        >
          <BookOpen
            className="h-4 w-4"
            style={{ color: "var(--sub)" }}
          />
          <Text variant="body" weight="semibold" as="h2">
            포트폴리오 가이드북
          </Text>
          <Button
            variant="icon"
            onClick={onClose}
            title="닫기  ESC"
            aria-label="닫기"
            className="ml-auto"
            style={{ color: "var(--faint)" }}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* 본문 — 스크롤 */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {/* GitHub 연결 — 셋업 단계 가장 위. 처음 사용자가 vault 만 보고 카드 안 떠 당황하지
              않도록 "왜 안 보일 수 있는지 + 어떻게 푸는지" 진입 */}
          <Section icon={<Plug className="h-4 w-4" />} title="GitHub 연결">
            <p>
              포트폴리오는 본인 머신의{" "}
              <Code>gh</Code> CLI 가 본인 GitHub 토큰을 들고 PR 을 가져오는 구조.
              앱 자체는 GitHub 토큰을 저장하지 않습니다 — gh 가 OS keychain 에 보관한
              걸 빌립니다. 셋업은 두 단계.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={onOpenInstallGuide}
                leftIcon={<Download className="h-3.5 w-3.5" />}
              >
                gh CLI 설치
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={onOpenAuthGuide}
                leftIcon={<KeyRound className="h-3.5 w-3.5" />}
              >
                GitHub 로그인 / 계정 변경
              </Button>
            </div>
            <p className="muted mt-2 text-2xs">
              회사 GitHub Enterprise 면 로그인 가이드 안에{" "}
              <Code>--hostname github.your-company.com</Code> 옵션 안내.
            </p>
          </Section>

          {/* 동기화 */}
          <Section icon={<RefreshCcw className="h-4 w-4" />} title="동기화">
            <p>
              <strong>사이드바 [동기화]</strong> = 마지막 sync 이후 변경된 PR
              만 가져옴 (<Code>gh search prs --author @me --merged
              --merged-at &apos;&gt;=last_sync-1d&apos;</Code>). 평소엔 이거면 충분 —
              빠르고 가벼움. 앱 켜면 5초 뒤 자동 한 번 더 돔.
            </p>
            <p>
              vault <Code>portfolio/</Code> 폴더에 카드 md 파일로 누적. repo →
              project 자동 분류 (첫 sync 시{" "}
              <Code>portfolio/projects.md</Code> 부트스트랩).{" "}
              <Code>github_pr_id</Code> 영구 식별자로 PR rename 자동 감지.
              본인이 수정한 frontmatter (impact_summary / category / project
              / included / screenshots) 는 sync 가 덮어쓰지 않음 — read-only
              github_* 필드만 갱신.
            </p>

            <div
              className="mt-3 flex flex-col gap-2 rounded-md p-3"
              style={{
                backgroundColor: "var(--surface-2)",
                border: "1px solid var(--line)",
              }}
            >
              <div className="flex items-center gap-2">
                <Button
                  variant="primary"
                  size="sm"
                  onClick={onFullSyncRun}
                  disabled={fullSyncRunning}
                  leftIcon={
                    fullSyncRunning ? (
                      <Spinner size="sm" />
                    ) : (
                      <RefreshCcw className="h-3.5 w-3.5" />
                    )
                  }
                  className="disabled:opacity-50"
                >
                  {fullSyncRunning ? "동기화 중…" : "전체 다시 훑기"}
                </Button>
                <Text
                  variant="caption"
                  color="muted"
                  as="span"
                  className="text-2xs"
                >
                  옛 PR 메타 갱신 / 카드 살리기용
                </Text>
              </div>
              <Text
                variant="caption"
                color="muted"
                as="p"
                className="text-2xs leading-relaxed"
              >
                평소엔 안 누름. 이런 때 가끔 사용:
              </Text>
              <Text
                variant="caption"
                color="muted"
                as="ul"
                className="ml-4 list-disc text-2xs leading-relaxed"
              >
                <li>본인이 GitHub 에서 repo 이름 / owner 옮긴 직후 — 옛 PR 의 owner/repo 갱신을 따라가기 위해.</li>
                <li>옛 PR 의 제목 / body / +N −M 변경 반영.</li>
                <li>vault 의 카드 파일을 실수로 옮기거나 삭제했을 때 다시 만들기.</li>
              </Text>
            </div>

            <div
              className="mt-3 rounded-md p-3 text-2xs leading-relaxed"
              style={{
                backgroundColor: "var(--accent-soft)",
                color: "var(--accent-ink)",
                border: "1px solid var(--accent)",
              }}
            >
              <strong>휴지통 vs 미사용 — 부활 동작 차이</strong>
              <ul className="mt-1 ml-4 list-disc">
                <li>
                  <strong>휴지통</strong> 카드는 <strong>전체 동기화</strong>
                  시 같은 PR 로 새 카드가 다시 생성됩니다 (incremental
                  [동기화] 는 영향 없음). 휴지통 = 임시 자리.
                </li>
                <li>
                  부활 없이 안 보이게만 두려면 카드 메뉴의 <Kbd>미사용</Kbd>
                  으로 — sync 가 덮어쓰지 않고 보존됨.
                </li>
                <li>
                  휴지통에서 <Kbd>미사용 복원</Kbd> 누르면 자동으로 미사용
                  자리로 돌아갑니다.
                </li>
              </ul>
            </div>
          </Section>

          {/* Claude 자동 채움 */}
          <Section
            icon={<Sparkles className="h-4 w-4" />}
            title="Claude 로 카드 자동 채움"
          >
            <p>
              새 PR 이 들어오면 <Code>impact_summary</Code> 가 비어있어 카드가{" "}
              <em>dashed border</em> 로 표시됨. 채우는 두 가지 방법:
            </p>
            <ol>
              <li>
                <strong>자동 (1-click)</strong> — 카드 클릭 → 모달의{" "}
                <Kbd>✨ Claude 한테 요청</Kbd> → 본인 머신의 <Code>claude</Code>{" "}
                CLI 가 구독 자격으로 호출 (API key 불필요).
                그 PR 의 title / body / +N −M 보고 한 줄 임팩트 + 카테고리 제안.{" "}
                <Kbd>적용</Kbd> 누르면 vault 저장. 마음에 안 들면{" "}
                <Kbd>다시 요청</Kbd>.
              </li>
              <li>
                <strong>수동 paste</strong> — 같은 영역의{" "}
                <Kbd>직접 입력</Kbd> 토글 → <Kbd>프롬프트 복사</Kbd> → 아무
                Claude (claude.ai / 다른 세션) 에게 paste → 응답 복사 → paste
                area 에 paste. <Code>parsePRResponse()</Code> 가 H3 split 으로
                impact / category 자동 채움.
              </li>
            </ol>
            <p className="muted">
              CLI 가 없거나 인증 안 됐으면 에러 박스에 안내가 뜸. 수동 흐름
              그대로 진행 가능.
            </p>
          </Section>

          {/* 프롬프트 도구 */}
          <Section
            icon={<Wand2 className="h-4 w-4" />}
            title="프롬프트 도구"
          >
            <p>
              다른 repo 의 Claude Code 세션에 paste 해서 사용하는 system 레벨
              프롬프트. 각 버튼 = 클립보드 복사.
            </p>
            <div className="mt-3 flex flex-col gap-3">
              <PromptRow
                label="PR 가이드 프롬프트 복사"
                description="다른 repo 의 Claude Code 에게 '앞으로 PR 만들 땐 포트폴리오 호환 양식 (7섹션: 한 줄 임팩트 / 문제 / Before / After / 디자인 결정 / 유저 가치 / 카테고리) 따라라' 라고 시키는 프롬프트."
                buildPrompt={() => buildPRGuidePrompt()}
              />
              <PromptRow
                label="Legacy 카드 프롬프트 복사"
                description="PR 없이 직접 main 에 push 한 repo 에서 commit 단위로 vault portfolio 카드 (frontmatter + 본문) 를 만들도록 Claude 에게 시킴. pr_number=0 인 legacy 카드 생성."
                buildPrompt={() => buildLegacyCardPrompt(vaultRoot)}
              />
            </div>
          </Section>
        </div>
    </Modal>
  );
}

function Section({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-6 last:mb-0">
      <Text
        variant="body"
        weight="semibold"
        as="h3"
        className="mb-2 flex items-center gap-1.5"
      >
        {icon}
        {title}
      </Text>
      <div className="guide-body">{children}</div>
    </section>
  );
}

function PromptRow({
  label,
  description,
  buildPrompt,
}: {
  label: string;
  description: string;
  buildPrompt: () => string;
}) {
  return (
    <div className="flex flex-col items-start gap-1.5">
      <ClipPromptButton
        buildPrompt={buildPrompt}
        label={label}
        title={description}
      />
      <Text
        variant="caption"
        color="muted"
        as="p"
        className="text-2xs leading-relaxed"
      >
        {description}
      </Text>
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <KbdCommon className="h-auto rounded px-1 py-px">
      {children}
    </KbdCommon>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code
      className="rounded px-1 py-px font-mono text-2xs"
      style={{
        backgroundColor: "var(--surface-2)",
        color: "var(--sub)",
      }}
    >
      {children}
    </code>
  );
}
