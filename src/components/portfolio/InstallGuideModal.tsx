import { Download, RefreshCcw, X } from "lucide-react";
import { Modal } from "../common/Modal";
import { Button } from "../common/Button";
import { Text } from "../common/Text";
import { CommandBlock } from "../common/CommandBlock";

type Props = {
  open: boolean;
  onClose: () => void;
  // 사용자가 설치 직후 바로 재시도할 수 있도록 모달 footer 에 노출.
  onRetrySync: () => void;
  retryRunning: boolean;
};

// gh CLI 미설치 감지 시 사이드바에서 트리거. 평면 3 카드 (macOS / Windows / Linux)
// — OS 자동 감지 안 함 (본인 mac 1대 dogfood 라 작음 + 가이드북에서도 같은 모달 재활용
// 시 다른 OS 도 보임). 마지막에 검증 명령어 + 트러블슛.
export function InstallGuideModal({
  open,
  onClose,
  onRetrySync,
  retryRunning,
}: Props) {
  return (
    <Modal open={open} onClose={onClose} size="lg" ariaLabel="GitHub CLI 설치 가이드">
      {/* 헤더 */}
      <div
        className="flex shrink-0 items-center gap-2 px-5 py-3"
        style={{ borderBottom: "1px solid var(--line)" }}
      >
        <Download
          className="h-4 w-4"
          style={{ color: "var(--sub)" }}
        />
        <Text variant="body" weight="semibold" as="h2">
          GitHub CLI 설치
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
          포트폴리오 동기화는 본인 머신의{" "}
          <code
            className="rounded px-1 py-px font-mono text-2xs"
            style={{
              backgroundColor: "var(--surface-2)",
              color: "var(--sub)",
            }}
          >
            gh
          </code>{" "}
          CLI 가 본인 GitHub 토큰을 들고 PR 을 가져옵니다. 아래 OS 에 맞춰 설치하세요.
        </Text>

        <OsSection title="macOS" subtitle="Homebrew 가 가장 빠릅니다">
          <CommandBlock command="brew install gh" />
          <Text
            variant="caption"
            color="muted"
            as="p"
            className="mt-1 text-2xs"
          >
            Homebrew 가 없으면{" "}
            <a
              href="https://brew.sh"
              target="_blank"
              rel="noreferrer"
              style={{ color: "var(--accent)" }}
            >
              brew.sh
            </a>{" "}
            먼저 설치.
          </Text>
        </OsSection>

        <OsSection title="Windows" subtitle="winget (Windows 10+ 기본 탑재)">
          <CommandBlock command="winget install --id GitHub.cli" />
          <Text
            variant="caption"
            color="muted"
            as="p"
            className="mt-1 text-2xs"
          >
            Scoop 쓰면{" "}
            <code
              className="rounded px-1 py-px font-mono text-2xs"
              style={{
                backgroundColor: "var(--surface-2)",
                color: "var(--sub)",
              }}
            >
              scoop install gh
            </code>
            .
          </Text>
        </OsSection>

        <OsSection title="Linux" subtitle="apt (Debian / Ubuntu)">
          <CommandBlock command="sudo apt install gh" />
          <Text
            variant="caption"
            color="muted"
            as="p"
            className="mt-1 text-2xs"
          >
            Fedora:{" "}
            <code
              className="rounded px-1 py-px font-mono text-2xs"
              style={{
                backgroundColor: "var(--surface-2)",
                color: "var(--sub)",
              }}
            >
              sudo dnf install gh
            </code>
            . 다른 배포판은{" "}
            <a
              href="https://github.com/cli/cli#installation"
              target="_blank"
              rel="noreferrer"
              style={{ color: "var(--accent)" }}
            >
              공식 설치 가이드
            </a>{" "}
            참조.
          </Text>
        </OsSection>

        {/* 검증 */}
        <section className="mt-6">
          <Text
            variant="body"
            weight="semibold"
            as="h3"
            className="mb-2"
          >
            설치 확인
          </Text>
          <Text variant="body" color="secondary" as="p" className="mb-2">
            터미널에서 아래를 실행해 버전이 출력되면 OK.
          </Text>
          <CommandBlock command="gh --version" />
        </section>

        {/* 트러블슛 */}
        <section
          className="mt-4 rounded-md p-3 text-2xs leading-relaxed"
          style={{
            backgroundColor: "var(--accent-soft)",
            color: "var(--accent-ink)",
            border: "1px solid var(--accent)",
          }}
        >
          <strong>이미 설치돼있는데도 안 잡힘?</strong>
          <p className="mt-1">
            macOS 의 경우 앱이{" "}
            <code className="font-mono">sh -lc &quot;gh ...&quot;</code> 로 실행해 로그인
            셸 PATH 를 가져옵니다. 터미널에선 잡히는데 앱에선 안 잡힌다면 셸 rc 파일
            (<code className="font-mono">~/.zshrc</code> /{" "}
            <code className="font-mono">~/.bashrc</code>) 에 PATH 가 export 되어
            있는지 확인. Homebrew 경로 (Apple Silicon{" "}
            <code className="font-mono">/opt/homebrew/bin</code>, Intel{" "}
            <code className="font-mono">/usr/local/bin</code>) 가 PATH 에 있어야 합니다.
          </p>
        </section>
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
          {retryRunning ? "확인 중…" : "설치 후 다시 동기화"}
        </Button>
      </div>
    </Modal>
  );
}

function OsSection({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-4">
      <div className="mb-1.5 flex items-baseline gap-2">
        <Text variant="body" weight="semibold" as="h3">
          {title}
        </Text>
        {subtitle ? (
          <Text variant="caption" color="muted" as="span" className="text-2xs">
            {subtitle}
          </Text>
        ) : null}
      </div>
      {children}
    </section>
  );
}
