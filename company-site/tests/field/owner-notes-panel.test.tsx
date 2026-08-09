import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import OwnerNotesPanel from "../../app/field/components/OwnerNotesPanel";
import type { OwnerNote, OwnerNoteDraft } from "../../app/field/lib/types";

const staffSession = {
  uid: "staff-1",
  displayName: "BRING staff",
  role: "staff" as const,
};

const persistedDraft: OwnerNoteDraft = {
  localId: "persisted-note-1",
  draftId: "draft-owner-notes",
  body: "보일러 확인",
  recordedAt: "2026-08-10T00:00:00.000Z",
};

function serverNote(overrides: Partial<OwnerNote> = {}): OwnerNote {
  return {
    id: "server-note-1",
    buildingId: "building-1",
    body: "서버 전달사항",
    recordedAt: "2026-08-10T00:00:00.000Z",
    createdAt: "2026-08-10T00:00:01.000Z",
    createdBy: "staff-1",
    createdByName: "BRING staff",
    ...overrides,
  };
}

describe("OwnerNotesPanel persistence hardening", () => {
  it("retries a persisted existing-building draft with the same local ID after remount", async () => {
    const appendNote = vi.fn(async (input) => serverNote({
      id: input.localId,
      body: input.body,
      recordedAt: input.recordedAt,
    }));

    render(
      <OwnerNotesPanel
        buildingId="building-1"
        draftId="draft-owner-notes"
        currentUser={staffSession}
        draftNotes={[persistedDraft]}
        onDraftNotesChange={vi.fn()}
        initialExpanded
        appendNote={appendNote}
        subscribeNotes={() => () => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));

    await waitFor(() => expect(appendNote).toHaveBeenCalledWith({
      buildingId: "building-1",
      localId: persistedDraft.localId,
      body: persistedDraft.body,
      recordedAt: persistedDraft.recordedAt,
    }));
  });

  it("switches from the latest 50 notes to all notes and back", async () => {
    const subscribeNotes = vi.fn(() => vi.fn());

    render(
      <OwnerNotesPanel
        buildingId="building-1"
        draftId="draft-owner-notes"
        currentUser={staffSession}
        draftNotes={[]}
        onDraftNotesChange={vi.fn()}
        initialExpanded
        subscribeNotes={subscribeNotes}
      />,
    );

    expect(subscribeNotes).toHaveBeenLastCalledWith(
      "building-1",
      expect.any(Function),
      expect.any(Function),
      { limit: 50 },
    );

    fireEvent.click(screen.getByRole("button", { name: "전체 메모 보기" }));
    await waitFor(() => expect(subscribeNotes).toHaveBeenLastCalledWith(
      "building-1",
      expect.any(Function),
      expect.any(Function),
      {},
    ));

    fireEvent.click(screen.getByRole("button", { name: "최근 메모만 보기" }));
    await waitFor(() => expect(subscribeNotes).toHaveBeenLastCalledWith(
      "building-1",
      expect.any(Function),
      expect.any(Function),
      { limit: 50 },
    ));
  });

  it("marks only server notes saved more than five minutes after recording as offline", async () => {
    let emit: ((notes: OwnerNote[]) => void) | undefined;

    render(
      <OwnerNotesPanel
        buildingId="building-1"
        draftId="draft-owner-notes"
        currentUser={staffSession}
        draftNotes={[persistedDraft]}
        onDraftNotesChange={vi.fn()}
        initialExpanded
        now={() => "2026-08-10T02:00:00.000Z"}
        subscribeNotes={(_buildingId, listener) => {
          emit = listener;
          return () => undefined;
        }}
      />,
    );

    act(() => emit?.([serverNote({
      body: "오프라인 서버 메모",
      createdAt: "2026-08-10T00:05:00.001Z",
    })]));

    const badge = await screen.findByText("오프라인에서 기록됨");
    const noteList = screen.getByRole("list", { name: "기록된 건물주 전달사항" });
    const serverItem = within(noteList).getByText("오프라인 서버 메모").closest("li");
    const localItem = within(noteList).getByText(persistedDraft.body).closest("li");

    expect(serverItem).not.toBeNull();
    expect(localItem).not.toBeNull();
    expect(serverItem).toContainElement(badge);
    expect(within(localItem as HTMLElement).queryByText("오프라인에서 기록됨"))
      .not.toBeInTheDocument();
  });

  it("uses the specified accessible composer label", () => {
    render(
      <OwnerNotesPanel
        draftId="draft-owner-notes"
        currentUser={staffSession}
        draftNotes={[]}
        onDraftNotesChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "메모 추가" }));
    expect(screen.getByLabelText("새 건물주 전달사항")).toBeInTheDocument();
  });

  it("keeps the sticky panel below the mobile and desktop headers", async () => {
    const css = await readFile(resolve("app/field/field.css"), "utf8");

    expect(css).toMatch(
      /\.field-owner-notes\s*\{(?=[^}]*position:\s*sticky)[^}]*top:\s*70px;/,
    );
    expect(css).toMatch(
      /@media \(min-width:\s*960px\)\s*\{\s*\.field-owner-notes\s*\{\s*top:\s*78px;\s*\}\s*\}/,
    );
  });
});
