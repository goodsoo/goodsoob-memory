import { KeyRound, RefreshCcw, X } from "lucide-react";
import { Modal } from "../common/Modal";
import { Button } from "../common/Button";
import { Text } from "../common/Text";
import { CommandBlock } from "../common/CommandBlock";

type Props = {
  open: boolean;
  onClose: () => void;
  // 사용자가 로그인 직후 바로 재시도할 수 있도록 footer 노출.
  onRetrySync: () => void;
  retryRunning: boolean;
  // GitHub Enterprise 호스트 명시 시 명령어에 --hostname 안내.
  host?: string;
};

// gh 미로그인 감지 시 사이드바에서 트리거. 처음 로그인 / 계정 변경 / 엔터프라이즈
// hostname / 확인 — 4 섹션.
export function AuthGuideModal({
  open,
  onClose,
  onRetrySync,
  retryRunning,
  host = "github.com",
}: Props) {
  const isEnterprise = host !== "github.com";
  const loginCmd = isEnterprise
    ? `gh auth login --hostname ${host}`
    : "gh auth login";
  const logoutCmd = isEnterprise
    ? `gh auth logout --hostname ${host}`
    : "gh auth logout";

  return (
    <Modal open={open} onClose={onClose} size="lg" ariaLabel="GitHub 로그인 가이드">
      {/* 헤더 */}
      <div
        className="flex shrink-0 items-center gap-2 px-5 py-3"
        style={{ borderBottom: "1px solid var(--line)" }}
      >
        <KeyRound
          className="h-4 w-4"
          style={{ color: "var(--sub)" }}
        />
        <Text variant="body" weight="semibold" as="h2">
          GitHub 로그인
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

      {/* 본문 */}
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <Text variant="body" color="secondary" as="p" className="mb-4">
          gh CLI 는 본인 GitHub 토큰을 macOS keychain (또는 Windows credential
          manager) 에 저장합니다. 앱은 그 토큰을 빌려 PR 을 가져옵니다.
        </Text>

        {/* 처음 로그인 */}
        <Section title="처음 로그인" stepNumber={1}>
          <Text variant="body" color="secondary" as="p" className="mb-2">
            터미널에서 실행:
          </Text>
          <CommandBlock command={loginCmd} />
          <Text
            variant="caption"
            color="muted"
            as="p"
            className="mt-2 text-2xs leading-relaxed"
          >
            대화형 안내가 뜸 — <strong>GitHub.com</strong> → <strong>HTTPS</strong> →{" "}
            <strong>Login with a web browser</strong> 권장. 일회용 코드가 표시되고
            브라우저 자동 열림 → 코드 입력 → 권한 승인. 끝나면 토큰이 keychain 에
            저장됩니다.
          </Text>
        </Section>

        {/* 계정 변경 */}
        <Section title="계정 변경" stepNumber={2}>
          <Text variant="body" color="secondary" as="p" className="mb-2">
            로그인된 계정 빼고 다른 계정으로:
          </Text>
          <div className="flex flex-col gap-2">
            <CommandBlock command={logoutCmd} caption="현재 계정 로그아웃" />
            <CommandBlock command={loginCmd} caption="새 계정 로그인" />
          </div>
          <Text
            variant="caption"
            color="muted"
            as="p"
            className="mt-2 text-2xs leading-relaxed"
          >
            여러 계정을 동시에 두고 전환만 하려면{" "}
            <code className="font-mono">gh auth switch</code> (gh 2.40+).
            로그아웃 안 해도 됩니다.
          </Text>
        </Section>

        {/* 엔터프라이즈 */}
        {!isEnterprise ? (
          <Section title="회사 GitHub Enterprise" stepNumber={3}>
            <Text variant="body" color="secondary" as="p" className="mb-2">
              회사 GitHub 서버를 쓰면 hostname 명시:
            </Text>
            <CommandBlock command="gh auth login --hostname github.your-company.com" />
            <Text
              variant="caption"
              color="muted"
              as="p"
              className="mt-2 text-2xs"
            >
              GitHub.com 계정과 별개로 저장돼 둘 다 로그인 가능.
            </Text>
          </Section>
        ) : null}

        {/* 확인 */}
        <Section title="로그인 확인" stepNumber={isEnterprise ? 3 : 4}>
          <Text variant="body" color="secondary" as="p" className="mb-2">
            현재 로그인된 계정 + 호스트 확인:
          </Text>
          <CommandBlock command="gh auth status" />
        </Section>
      </div>

      {/* footer */}
      <div
        className="flex shrink-0 items-center justify-end gap-2 px-5 py-3"
        style={{ borderTop: "1px solid var(--line)" }}
      >
        <Button variant="secondary" onClick={onClose}>
          닫기
        </Button>
        <Button
          variant="primary"
          onClick={onRetrySync}
          disabled={retryRunning}
          leftIcon={<RefreshCcw className="h-3.5 w-3.5" />}
        >
          {retryRunning ? "확인 중…" : "로그인 후 다시 동기화"}
        </Button>
      </div>
    </Modal>
  );
}

function Section({
  title,
  stepNumber,
  children,
}: {
  title: string;
  stepNumber: number;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-5 last:mb-0">
      <div className="mb-2 flex items-baseline gap-2">
        <span
          className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-2xs font-semibold"
          style={{
            backgroundColor: "var(--surface-3)",
            color: "var(--ink)",
          }}
        >
          {stepNumber}
        </span>
        <Text variant="body" weight="semibold" as="h3">
          {title}
        </Text>
      </div>
      <div className="ml-7">{children}</div>
    </section>
  );
}
