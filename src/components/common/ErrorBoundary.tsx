// ErrorBoundary — 한 컴포넌트의 throw 가 앱 전체를 unmount 하는 걸 막는 최상위 방어막.
// class component 필수 (getDerivedStateFromError 는 훅 미지원). 디자인 토큰 var(--*) 만 사용.
//
// Fallback UI: heading + body + CTA 3단 (DESIGN.md empty state 규칙).
// 에러 메시지: 원인 + 해결 2단, 사과 X (DESIGN.md 에러 메시지 규칙).
// 종결어미 ~합니다, 액션 라벨 명사형 (DESIGN.md voice/tone).

import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** 슬롯 — 제공하지 않으면 기본 fallback 렌더. */
  fallback?: (error: Error, reset: () => void) => ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // 프로덕션에서도 콘솔 에러로 흔적 남김 — silent fail 금지 원칙.
    console.error("[ErrorBoundary] 컴포넌트 에러:", error, info.componentStack);
  }

  reset = () => {
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    const { children, fallback } = this.props;

    if (!error) return children;

    if (fallback) return fallback(error, this.reset);

    return <DefaultFallback error={error} onReset={this.reset} />;
  }
}

// ── 기본 fallback UI ─────────────────────────────────────────────────────────
function DefaultFallback({ error, onReset }: { error: Error; onReset: () => void }) {
  return (
    <main
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100svh",
        padding: "1.5rem",
        background: "var(--bg)",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "28rem",
          borderRadius: "0.75rem",
          padding: "1.5rem",
          background: "var(--surface)",
          border: "1px solid var(--line)",
        }}
      >
        {/* heading */}
        <p
          style={{
            margin: "0 0 0.5rem",
            fontSize: "1.125rem",
            fontWeight: 700,
            color: "var(--text-primary)",
            lineHeight: 1.4,
          }}
        >
          화면을 불러올 수 없습니다
        </p>

        {/* body — 원인 + 해결 2단 */}
        <p
          style={{
            margin: "0 0 1rem",
            fontSize: "0.875rem",
            color: "var(--text-secondary)",
            lineHeight: 1.6,
          }}
        >
          예기치 못한 오류가 발생했습니다. 아래 버튼으로 다시 시도하거나
          앱을 새로 고침하세요.
        </p>

        {/* 에러 상세 — 개발·디버그용 */}
        <pre
          style={{
            margin: "0 0 1.25rem",
            padding: "0.625rem 0.75rem",
            borderRadius: "0.375rem",
            background: "var(--bg)",
            border: "1px solid var(--line)",
            fontSize: "0.75rem",
            color: "var(--text-secondary)",
            whiteSpace: "pre-wrap",
            wordBreak: "break-all",
            maxHeight: "8rem",
            overflow: "auto",
          }}
        >
          {error.message || String(error)}
        </pre>

        {/* CTA — 명사형 액션 라벨 */}
        <button
          type="button"
          onClick={onReset}
          style={{
            display: "block",
            width: "100%",
            padding: "0.625rem 1rem",
            borderRadius: "0.5rem",
            border: "none",
            cursor: "pointer",
            fontSize: "0.875rem",
            fontWeight: 600,
            background: "var(--down)",
            color: "#fff",
            marginBottom: "0.5rem",
          }}
        >
          다시 시도
        </button>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            display: "block",
            width: "100%",
            padding: "0.625rem 1rem",
            borderRadius: "0.5rem",
            border: "1px solid var(--line)",
            cursor: "pointer",
            fontSize: "0.875rem",
            fontWeight: 500,
            background: "var(--surface)",
            color: "var(--text-primary)",
          }}
        >
          새로 고침
        </button>
      </div>
    </main>
  );
}
