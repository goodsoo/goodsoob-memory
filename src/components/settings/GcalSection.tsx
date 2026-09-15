import { useEffect, useState } from "react";
import {
  CalendarDays,
  CalendarPlus,
  Check,
  Link2,
  Link2Off,
  Pencil,
  RefreshCw,
} from "lucide-react";
import { Button } from "../common/Button";
import { Text } from "../common/Text";
import { Spinner } from "../common/Spinner";
import { Toggle } from "../common/Toggle";
import { useToast } from "../Toast";
import { useGcalSync } from "../../hooks/useGcalSync";
import {
  gcalAuthStart,
  gcalAuthStatus,
  gcalDisconnect,
  GcalError,
  type AuthStatus,
} from "../../lib/gcal/transport";
import { loadSyncState, updateSyncState } from "../../lib/gcal/stateStore";
import { createCalendar, patchCalendar } from "../../lib/gcal/api";
import { localTimeZone } from "../../lib/gcal/executor";

const DEFAULT_CALENDAR_NAME = "goodsoob";

// 마지막 동기화 시각을 상대 표현으로 (voice/tone: 목록은 상대 시간).
function relativeSince(iso: string | null): string {
  if (!iso) return "아직 동기화 안 함";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "아직 동기화 안 함";
  const min = Math.floor((Date.now() - t) / 60000);
  if (min < 1) return "방금 동기화함";
  if (min < 60) return `${min}분 전 동기화함`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전 동기화함`;
  return `${Math.floor(hr / 24)}일 전 동기화함`;
}

// Google 캘린더 연동 설정. 연동/해제 + 전용 캘린더(생성·이름변경) + 자동 동기화
// 토글 + 수동 "지금 동기화" + 재인증 CTA.
export function GcalSection() {
  const toast = useToast();
  const sync = useGcalSync();
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [calendarId, setCalendarId] = useState<string | null>(null);
  const [calendarName, setCalendarName] = useState<string | null>(null);
  const [autoSync, setAutoSync] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 캘린더 이름 입력 draft — 생성 전(미생성) 또는 rename 시.
  const [nameDraft, setNameDraft] = useState(DEFAULT_CALENDAR_NAME);
  const [renaming, setRenaming] = useState(false);

  async function refresh() {
    try {
      const [s, state] = await Promise.all([gcalAuthStatus(), loadSyncState()]);
      setStatus(s);
      setCalendarId(state.calendarId);
      setCalendarName(state.calendarName);
      setAutoSync(state.autoSyncEnabled);
      if (state.calendarName) setNameDraft(state.calendarName);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
    // 할 일 헤더 동기화 칩도 즉시 최신화 (포커스 이벤트 기다리지 않게).
    void sync.refresh();
  }

  /* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */
  useEffect(() => {
    void refresh();
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */

  async function handleConnect() {
    setError(null);
    setBusy(true);
    try {
      await gcalAuthStart();
      await updateSyncState((s) => ({ ...s, authState: "linked" }));
      await refresh();
      toast.show("Google 캘린더를 연동했습니다.", { kind: "info" });
    } catch (err) {
      const msg =
        err instanceof GcalError && err.kind === "NotConfigured"
          ? "GCAL_CLIENT_SECRET 환경변수가 없습니다. 빌드/실행 환경에 설정하고 다시 시도하세요."
          : err instanceof Error
            ? err.message
            : String(err);
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  async function handleDisconnect() {
    setError(null);
    setBusy(true);
    try {
      await gcalDisconnect();
      await updateSyncState((s) => ({ ...s, authState: "disconnected" }));
      await refresh();
      toast.show("Google 캘린더 연동을 해제했습니다.", { kind: "info" });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateCalendar() {
    const name = nameDraft.trim() || DEFAULT_CALENDAR_NAME;
    setError(null);
    setCreating(true);
    try {
      const cal = await createCalendar(name, localTimeZone());
      await updateSyncState((s) => ({
        ...s,
        calendarId: cal.id,
        calendarName: cal.summary ?? name,
        authState: "linked",
      }));
      await refresh();
      toast.show(`전용 "${name}" 캘린더를 만들었습니다.`, { kind: "info" });
    } catch (err) {
      const msg =
        err instanceof GcalError && err.needsReauth
          ? "인증이 만료됐습니다. 연동을 다시 하세요."
          : err instanceof Error
            ? err.message
            : String(err);
      setError(msg);
    } finally {
      setCreating(false);
    }
  }

  async function handleRename() {
    const name = nameDraft.trim();
    if (!calendarId || !name || name === calendarName) {
      setRenaming(false);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const cal = await patchCalendar(calendarId, name);
      await updateSyncState((s) => ({ ...s, calendarName: cal.summary ?? name }));
      setCalendarName(cal.summary ?? name);
      setRenaming(false);
      void sync.refresh();
      toast.show("캘린더 이름을 바꿨습니다.", { kind: "info" });
    } catch (err) {
      const msg =
        err instanceof GcalError && err.needsReauth
          ? "인증이 만료됐습니다. 연동을 다시 하세요."
          : err instanceof Error
            ? err.message
            : String(err);
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleAutoSync() {
    const next = !autoSync;
    setAutoSync(next);
    try {
      await updateSyncState((s) => ({ ...s, autoSyncEnabled: next }));
      void sync.refresh();
    } catch (err) {
      setAutoSync(!next); // 롤백
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleSyncNow() {
    await sync.syncNow();
  }

  const linked = status?.linked ?? false;
  const configured = status?.configured ?? false;
  const inputStyle = {
    background: "var(--surface)",
    border: "1px solid var(--line-2)",
    color: "var(--ink)",
  } as const;

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div
          className="flex items-center gap-3 rounded-lg px-3 py-3"
          style={{ background: "var(--bg)", border: "1px solid var(--line-2)" }}
        >
          <CalendarDays className="h-5 w-5 shrink-0" style={{ color: "var(--sub)" }} />
          <div className="min-w-0 flex-1">
            <Text variant="body" weight="semibold" as="div">
              Google 캘린더
            </Text>
            <Text variant="caption" color="muted" as="div">
              {loading
                ? "상태 확인 중…"
                : linked
                  ? "연동됨. 개인 캘린더는 건드리지 않고 전용 캘린더만 동기화합니다."
                  : "연동하면 날짜가 있는 모든 할 일을 Google 캘린더에서 함께 봅니다."}
            </Text>
          </div>
          {!loading &&
            (linked ? (
              <Button
                variant="ghost"
                onClick={handleDisconnect}
                disabled={busy}
                leftIcon={busy ? <Spinner size="sm" /> : <Link2Off className="h-4 w-4" />}
                className="shrink-0 rounded-lg px-3 py-2"
                style={{ color: "var(--sub)" }}
              >
                연동 해제
              </Button>
            ) : (
              <Button
                variant="primary"
                onClick={handleConnect}
                disabled={busy}
                leftIcon={busy ? <Spinner size="md" /> : <Link2 className="h-4 w-4" />}
                className="shrink-0 rounded-lg px-3 py-2 disabled:opacity-50"
              >
                {busy ? "연동 중…" : "Google 연동"}
              </Button>
            ))}
        </div>

        {!loading && !configured && (
          <Text
            variant="caption"
            as="div"
            className="rounded px-3 py-2"
            style={{
              color: "var(--down)",
              background: "var(--bg)",
              border: "1px solid var(--down)",
            }}
          >
            client secret 이 설정되지 않았습니다. 빌드/실행 환경에 GCAL_CLIENT_SECRET
            환경변수를 설정하세요.
          </Text>
        )}

        {/* 재인증 CTA — 동기화 중 인증 만료가 감지되면. */}
        {!loading && linked && sync.needsReauth && (
          <div
            className="flex items-center gap-3 rounded-lg px-3 py-3"
            style={{ background: "var(--bg)", border: "1px solid var(--down)" }}
          >
            <Text variant="caption" as="div" className="flex-1" style={{ color: "var(--down)" }}>
              Google 인증이 만료됐습니다. 동기화를 이어가려면 다시 연동하세요.
            </Text>
            <Button
              variant="primary"
              onClick={handleConnect}
              disabled={busy}
              leftIcon={busy ? <Spinner size="sm" /> : <Link2 className="h-4 w-4" />}
              className="shrink-0 rounded-lg px-3 py-2"
            >
              다시 연동
            </Button>
          </div>
        )}
      </section>

      {/* 전용 캘린더 — 연동됐을 때만. */}
      {!loading && linked && (
        <section className="space-y-2">
          <Text
            variant="caption"
            color="muted"
            as="h3"
            weight="semibold"
            className="uppercase tracking-wide"
          >
            전용 캘린더
          </Text>
          {calendarId ? (
            <div
              className="space-y-2 rounded-lg px-3 py-3"
              style={{ background: "var(--bg)", border: "1px solid var(--line-2)" }}
            >
              {renaming ? (
                <div className="flex items-center gap-2">
                  <input
                    value={nameDraft}
                    onChange={(e) => setNameDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void handleRename();
                      if (e.key === "Escape") {
                        setNameDraft(calendarName ?? DEFAULT_CALENDAR_NAME);
                        setRenaming(false);
                      }
                    }}
                    placeholder="캘린더 이름을 입력하세요"
                    className="min-w-0 flex-1 rounded px-2 py-1 text-sm outline-none"
                    style={inputStyle}
                    autoFocus
                  />
                  <Button
                    variant="primary"
                    onClick={handleRename}
                    disabled={busy}
                    leftIcon={busy ? <Spinner size="sm" /> : <Check className="h-4 w-4" />}
                    className="shrink-0 rounded px-2 py-1"
                  >
                    저장
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <Text variant="body" as="div" className="flex-1">
                    "{calendarName ?? DEFAULT_CALENDAR_NAME}" 캘린더 연결됨
                  </Text>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setNameDraft(calendarName ?? DEFAULT_CALENDAR_NAME);
                      setRenaming(true);
                    }}
                    aria-label="캘린더 이름 변경"
                    title="이름 변경"
                    className="shrink-0 rounded px-2 py-1"
                    style={{ color: "var(--faint)" }}
                    leftIcon={<Pencil className="h-3.5 w-3.5" />}
                  >
                    이름 변경
                  </Button>
                </div>
              )}
              <Text
                variant="caption"
                color="muted"
                as="div"
                className="break-all"
                style={{ fontFamily: "var(--font-mono, monospace)" }}
              >
                {calendarId}
              </Text>
            </div>
          ) : (
            <div className="space-y-2">
              <Text variant="caption" color="secondary" as="p">
                할 일을 올릴 전용 캘린더를 새로 만듭니다. 개인 일정이 든 캘린더는
                건드리지 않습니다.
              </Text>
              <div className="flex items-center gap-2">
                <input
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !creating) void handleCreateCalendar();
                  }}
                  placeholder="캘린더 이름을 입력하세요"
                  className="min-w-0 flex-1 rounded px-2 py-2 text-sm outline-none"
                  style={inputStyle}
                />
                <Button
                  variant="primary"
                  onClick={handleCreateCalendar}
                  disabled={creating}
                  leftIcon={creating ? <Spinner size="md" /> : <CalendarPlus className="h-4 w-4" />}
                  className="shrink-0 rounded-lg px-3 py-2 disabled:opacity-50"
                >
                  {creating ? "만드는 중…" : "캘린더 만들기"}
                </Button>
              </div>
            </div>
          )}
        </section>
      )}

      {/* 동기화 — 연동 + 전용 캘린더 있을 때만. */}
      {!loading && linked && calendarId && (
        <section className="space-y-3">
          <Text
            variant="caption"
            color="muted"
            as="h3"
            weight="semibold"
            className="uppercase tracking-wide"
          >
            동기화
          </Text>

          {/* 자동 동기화 토글. */}
          <div
            className="flex items-center gap-3 rounded-lg px-3 py-3"
            style={{ background: "var(--bg)", border: "1px solid var(--line-2)" }}
          >
            <div className="min-w-0 flex-1">
              <Text variant="body" weight="semibold" as="div">
                자동 동기화
              </Text>
              <Text variant="caption" color="muted" as="div">
                앱을 열거나 다시 볼 때 자동으로 동기화합니다.
              </Text>
            </div>
            <Toggle
              checked={autoSync}
              onChange={handleToggleAutoSync}
              ariaLabel="자동 동기화"
              title={autoSync ? "자동 동기화 끄기" : "자동 동기화 켜기"}
            />
          </div>

          {/* 수동 동기화 + 마지막 시각. */}
          <div className="flex items-center gap-3">
            <Button
              variant="secondary"
              onClick={handleSyncNow}
              disabled={sync.status === "syncing"}
              leftIcon={
                sync.status === "syncing" ? (
                  <Spinner size="sm" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )
              }
              className="shrink-0 rounded-lg px-3 py-2 disabled:opacity-50"
            >
              {sync.status === "syncing" ? "동기화 중…" : "지금 동기화"}
            </Button>
            <Text variant="caption" color="muted" as="span">
              {sync.status === "syncing" ? "동기화 중…" : relativeSince(sync.lastSyncAt)}
            </Text>
          </div>

          {sync.status === "error" && sync.error && !sync.needsReauth && (
            <Text
              variant="caption"
              as="div"
              className="rounded px-3 py-2"
              style={{
                color: "var(--down)",
                background: "var(--bg)",
                border: "1px solid var(--down)",
              }}
            >
              동기화에 실패했습니다. {sync.error}
            </Text>
          )}
        </section>
      )}

      {error && (
        <Text
          variant="body"
          as="div"
          className="rounded px-3 py-2"
          style={{
            color: "var(--down)",
            background: "var(--bg)",
            border: "1px solid var(--down)",
          }}
        >
          {error}
        </Text>
      )}
    </div>
  );
}
