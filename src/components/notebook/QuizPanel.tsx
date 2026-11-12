// 노트북 퀴즈 — `_digest/quiz.json` 읽기 전용 객관식.
// 시작마다 문항 · 보기 순서를 섞는다 (answer 재매핑은 lib/notebook/quiz.shuffleQuiz).
// 진도 · 오답 · 좋아요 저장 없음 — 회차 끝에 맞은 개수만 보여준다.

import { useCallback, useEffect, useState } from "react";
import { Check, X } from "lucide-react";
import { Alert, Button, ListGroup, ListRow } from "@goodsoob/ds";
import type { CiteStatus } from "../../lib/notebook/check";
import { shuffleQuiz, type QuizParse, type QuizQuestion } from "../../lib/notebook/quiz";
import { EmptyState } from "../common/EmptyState";
import { Text } from "../common/Text";
import { CiteButton, type OpenCite } from "./CiteButton";

type Props = {
  quiz: QuizParse | null;
  citeStatusOf: (src: string, quote: string) => CiteStatus | undefined;
  onOpenCite: (c: OpenCite) => void;
};

type Round = {
  questions: QuizQuestion[];
  index: number;
  /** 현재 문항에서 고른 보기. null = 아직 안 고름 */
  picked: number | null;
  correct: number;
};

function formatDate(iso: string | null): string | null {
  const m = iso?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}.${m[2]}.${m[3]}` : null;
}

export function QuizPanel({ quiz, citeStatusOf, onOpenCite }: Props) {
  const [round, setRound] = useState<Round | null>(null);

  const start = useCallback(() => {
    if (!quiz?.ok) return;
    setRound({ questions: shuffleQuiz(quiz.quiz.questions), index: 0, picked: null, correct: 0 });
  }, [quiz]);

  const pick = useCallback((i: number) => {
    setRound((r) =>
      r && r.picked === null && r.index < r.questions.length
        ? { ...r, picked: i, correct: r.correct + (i === r.questions[r.index].answer ? 1 : 0) }
        : r,
    );
  }, []);

  const next = useCallback(() => {
    setRound((r) => (r && r.picked !== null ? { ...r, index: r.index + 1, picked: null } : r));
  }, []);

  // 1~4 = 보기 고르기, Enter = 다음 (입력창 밖에서만).
  useEffect(() => {
    if (!round || round.index >= round.questions.length) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, [contenteditable=true]") || e.metaKey || e.ctrlKey || e.altKey) return;
      if (/^[1-4]$/.test(e.key) && round.picked === null) {
        e.preventDefault();
        pick(Number(e.key) - 1);
      } else if (e.key === "Enter" && round.picked !== null) {
        e.preventDefault();
        next();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [round, pick, next]);

  if (quiz === null) {
    return (
      <EmptyState
        className="px-6 py-12"
        title="퀴즈가 없습니다"
        description="채팅에서 /study 로 이 노트북의 소화를 요청하면 _digest/quiz.json 이 만들어집니다."
      />
    );
  }
  if (!quiz.ok) {
    return (
      <Alert variant="down" title="퀴즈 파일을 읽지 못했습니다">
        _digest/quiz.json 형식이 깨졌습니다 ({quiz.error}). 채팅에서 퀴즈를 다시 만들어 달라고 요청하세요.
      </Alert>
    );
  }

  const total = quiz.quiz.questions.length;
  const skippedNote =
    quiz.skipped.length > 0 ? (
      <Alert variant="warn">
        형식이 맞지 않는 문항 {quiz.skipped.length}개를 건너뜁니다 (
        {quiz.skipped.map((s) => s.id ?? `#${s.index}`).join(", ")}).
      </Alert>
    ) : null;

  if (total === 0) {
    return (
      <div className="flex flex-col gap-4">
        {skippedNote}
        <EmptyState className="px-6 py-12" title="풀 수 있는 문항이 없습니다" description="채팅에서 퀴즈를 다시 만들어 달라고 요청하세요." />
      </div>
    );
  }

  // 시작 전
  if (!round) {
    const date = formatDate(quiz.quiz.generated_at);
    return (
      <div className="flex flex-col gap-4">
        {skippedNote}
        <div className="flex flex-col items-start gap-3">
          <Text variant="body" color="secondary" as="p">
            객관식 {total}문항{date ? ` · ${date} 생성` : ""}. 풀 때마다 문항과 보기 순서가 바뀌고, 기록은 남기지 않습니다.
          </Text>
          <Button variant="primary" onClick={start}>
            시작
          </Button>
        </div>
      </div>
    );
  }

  // 결과
  if (round.index >= round.questions.length) {
    return (
      <div className="flex flex-col items-start gap-3">
        <Text variant="h3" as="p">
          {round.questions.length}문항 중 {round.correct}개 맞음
        </Text>
        <Button variant="primary" onClick={start}>
          다시 풀기
        </Button>
      </div>
    );
  }

  const q = round.questions[round.index];
  const answered = round.picked !== null;
  const last = round.index === round.questions.length - 1;

  return (
    <div className="flex flex-col gap-4">
      <Text variant="caption" color="muted" as="p" className="tabular-nums">
        {round.index + 1} / {round.questions.length}
      </Text>
      <Text variant="h3" as="h3" weight="semibold">
        {q.q}
      </Text>
      <ListGroup>
        {q.choices.map((c, i) => {
          const isAnswer = i === q.answer;
          const isPicked = i === round.picked;
          return (
            <ListRow
              key={i}
              label={`${i + 1}. ${c}`}
              selected={answered && isPicked}
              dim={answered && !isAnswer && !isPicked}
              aria-disabled={answered || undefined}
              onClick={answered ? undefined : () => pick(i)}
              value={
                answered && isAnswer ? (
                  <span className="flex items-center gap-1" style={{ color: "var(--ok-ink)" }}>
                    <Check className="h-4 w-4" aria-hidden />
                    정답
                  </span>
                ) : answered && isPicked ? (
                  <span className="flex items-center gap-1" style={{ color: "var(--down-ink)" }}>
                    <X className="h-4 w-4" aria-hidden />
                    오답
                  </span>
                ) : undefined
              }
            />
          );
        })}
      </ListGroup>
      {answered ? (
        <div className="flex flex-col gap-3">
          {q.explanation ? (
            <Text variant="body" as="p" className="leading-relaxed">
              {q.explanation}
            </Text>
          ) : null}
          <div className="flex flex-wrap items-center gap-1.5">
            <Text variant="caption" color="muted" as="span">
              근거
            </Text>
            {q.cites.map((c, i) => (
              <CiteButton key={i} src={c.src} quote={c.quote} status={citeStatusOf(c.src, c.quote)} onOpen={onOpenCite} />
            ))}
          </div>
          <div>
            <Button variant="primary" onClick={next}>
              {last ? "결과 보기" : "다음"}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
