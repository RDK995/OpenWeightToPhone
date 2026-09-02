import { describe, it, expect } from "bun:test";
import { Window } from "happy-dom";
import { createDomTarget } from "../../../web/src/ui/dom-target";
import type { UiActions } from "../../../web/src/ui/actions";
import type { DomController } from "../../../web/src/ui/dom-target";
import type { ViewModel, GenerationDisplay } from "../../../web/src/ui/view-model";
import type { Profile } from "../../../web/src/api-client";
import type { Conversation } from "../../../web/src/conversation-store";
import { createMemoryStorage } from "../../../web/src/storage-port";
import {
  createConversationStore,
  CONVERSATIONS_STORAGE_KEY,
  CONVERSATIONS_SCHEMA_VERSION,
} from "../../../web/src/conversation-store";
import type { Turn } from "../../../web/src/conversation-store";
import { mount } from "../../../web/src/ui/mount";
import { HarnessApiError, HarnessStreamError, HarnessOfflineError, createApiClient } from "../../../web/src/api-client";
import type { GenerationHandlers, SendResult, ResumeResult } from "../../../web/src/session-coordinator";
import type { SessionCoordinator } from "../../../web/src/session-coordinator";
import { createSessionCoordinator } from "../../../web/src/session-coordinator";
import { buildViewModel } from "../../../web/src/ui/view-model";
import type { UiState } from "../../../web/src/ui/view-model";
import type { Telemetry } from "../../../web/src/sse-reader";

function createTestWindow() {
  const win = new Window();
  const doc = win.document;
  const root = doc.createElement("div");
  return { win, doc, root };
}

function createRecordingActions(): { actions: UiActions; calls: any[] } {
  const calls: any[] = [];
  const actions: UiActions = {
    async send(conversationId, prompt, handlers) {
      calls.push({ method: "send", args: [conversationId, prompt, handlers] });
      return {
        generationId: "gen-1",
        text: "response",
        status: "complete",
        telemetry: null,
        errorCode: null,
        streamError: null,
        sessionRebuilt: false,
        replayedTurns: 0,
      };
    },
    async cancel(conversationId) {
      calls.push({ method: "cancel", args: [conversationId] });
      return { status: "cancelled" };
    },
    async chooseProfile(conversationId, profileId) {
      calls.push({ method: "chooseProfile", args: [conversationId, profileId] });
      return {
        id: "conv-1",
        title: "Test",
        sessionId: null,
        profileId,
        turns: [],
        pending: null,
        createdAt: "2026-08-30T00:00:00Z",
        updatedAt: "2026-08-30T00:00:00Z",
      };
    },
    async resumeIfInterrupted(conversationId, handlers) {
      calls.push({ method: "resumeIfInterrupted", args: [conversationId, handlers] });
      return {
        resumed: false,
        generationId: "gen-1",
        text: "",
        status: "complete",
        telemetry: null,
        errorCode: null,
        streamError: null,
        reconciledFromSession: false,
        seqs: [],
      };
    },
    async listProfiles() {
      calls.push({ method: "listProfiles", args: [] });
      return [];
    },
    async createConversation(input) {
      calls.push({ method: "createConversation", args: [input] });
      return {
        id: "conv-new",
        title: input.title || "New Conversation",
        sessionId: null,
        profileId: input.profileId,
        turns: [],
        pending: null,
        createdAt: "2026-08-30T00:00:00Z",
        updatedAt: "2026-08-30T00:00:00Z",
      };
    },
    deleteConversation(conversationId) {
      calls.push({ method: "deleteConversation", args: [conversationId] });
    },
  };
  return { actions, calls };
}

function createTestViewModel(overrides: Partial<ViewModel> = {}): ViewModel {
  return {
    conversations: [],
    transcript: [],
    profiles: [],
    selectedProfileId: null,
    generation: { kind: "idle" },
    notice: null,
    ...overrides,
  };
}

// createDomTarget() builds six sections onto root, in this order: controls,
// conversations, transcript, profiles, status, notice. Only the conversations,
// transcript and profiles sections contain a <ul>, so the transcript <ul> is
// the second <ul> in document order. These helpers read the REAL rendered
// DOM (not the view model handed to paint(), and not the store), so tests
// using them prove what the mounted app actually painted.
function getTranscriptListElement(root: any): any {
  return root.querySelectorAll("ul")[1] ?? null;
}

// Reads the currently-rendered pending assistant transcript entry (the
// streaming projection) directly out of the DOM, or null if there is none.
function readPendingAssistantText(root: any): string | null {
  const list = getTranscriptListElement(root);
  const items: any[] = list ? Array.from(list.children) : [];
  const last = items[items.length - 1];
  if (!last) return null;
  const match = /^assistant: (.*) \(pending\)$/.exec(last.textContent ?? "");
  return match ? (match[1] ?? null) : null;
}

// Reads every rendered transcript <li>'s text content, in DOM order,
// directly out of the real mounted DOM (M13-T2).
function readTranscriptTexts(root: any): string[] {
  const list = getTranscriptListElement(root);
  const items: any[] = list ? Array.from(list.children) : [];
  return items.map((item) => item.textContent ?? "");
}

describe("createDomTarget", () => {
  it("exports DomTarget interface with attach method", () => {
    const { win, doc, root } = createTestWindow();
    const target = createDomTarget(root as any);
    expect(typeof target.attach).toBe("function");
    expect(typeof target.paint).toBe("function");
  });

  it("dispatching any control's event before attach() does not throw and calls nothing", () => {
    const { win, doc, root } = createTestWindow();
    const target = createDomTarget(root as any);

    const viewModel = createTestViewModel();
    target.paint(viewModel);

    // Find and dispatch a click on send button without attaching
    const sendBtn = root.querySelector('[data-testid="send"]') as any;
    expect(sendBtn).not.toBeNull();

    // This should not throw
    expect(() => {
      sendBtn.dispatchEvent(new win.Event("click"));
    }).not.toThrow();
  });

  describe("after attach()", () => {
    it("send button dispatches actions.send with correct arguments and clears input", async () => {
      const { win, doc, root } = createTestWindow();
      const target = createDomTarget(root as any);
      const { actions, calls } = createRecordingActions();

      const controller: DomController = {
        render: () => {},
        select: () => {},
        setGeneration: () => {},
        setStreamingText: () => {},
        setProfiles: () => {},
        setNotice: () => {},
      };

      target.attach({ actions, controller });

      const conv = {
        id: "conv-1",
        title: "Test",
        sessionId: null,
        profileId: "prof-1",
        turns: [],
        pending: null,
        createdAt: "2026-08-30T00:00:00Z",
        updatedAt: "2026-08-30T00:00:00Z",
      };

      const viewModel = createTestViewModel({
        conversations: [{ id: "conv-1", title: "Test", updatedAt: "2026-08-30", selected: true }],
      });
      target.paint(viewModel);

      const promptInput = root.querySelector('[data-testid="prompt-input"]') as any;
      promptInput.value = "hello world";

      const sendBtn = root.querySelector('[data-testid="send"]') as any;
      await sendBtn.dispatchEvent(new win.Event("click"));

      expect(calls.length).toBe(1);
      expect(calls[0]?.method).toBe("send");
      expect(calls[0]?.args[0]).toBe("conv-1");
      expect(calls[0]?.args[1]).toBe("hello world");
      expect(promptInput.value).toBe("");
    });

    it("send with empty string prompt makes no action call, leaves input unchanged, and says why via setNotice", async () => {
      const { win, doc, root } = createTestWindow();
      const target = createDomTarget(root as any);
      const { actions, calls } = createRecordingActions();

      const notices: (string | null)[] = [];
      const controller: DomController = {
        render: () => {},
        select: () => {},
        setGeneration: () => {},
        setStreamingText: () => {},
        setProfiles: () => {},
        setNotice: (notice) => notices.push(notice),
      };

      target.attach({ actions, controller });

      const viewModel = createTestViewModel({
        conversations: [{ id: "conv-1", title: "Test", updatedAt: "2026-08-30", selected: true }],
      });
      target.paint(viewModel);

      const promptInput = root.querySelector('[data-testid="prompt-input"]') as any;
      promptInput.value = "";

      const sendBtn = root.querySelector('[data-testid="send"]') as any;
      sendBtn.dispatchEvent(new win.Event("click"));

      expect(calls.length).toBe(0);
      expect(promptInput.value).toBe("");
      expect(notices).toHaveLength(1);
      expect(notices[0]).not.toBeNull();
      expect((notices[0] ?? "").toLowerCase()).toContain("prompt");
    });

    it("send with whitespace-only prompt makes no action call, leaves input unchanged, and says why via setNotice", async () => {
      const { win, doc, root } = createTestWindow();
      const target = createDomTarget(root as any);
      const { actions, calls } = createRecordingActions();

      const notices: (string | null)[] = [];
      const controller: DomController = {
        render: () => {},
        select: () => {},
        setGeneration: () => {},
        setStreamingText: () => {},
        setProfiles: () => {},
        setNotice: (notice) => notices.push(notice),
      };

      target.attach({ actions, controller });

      const viewModel = createTestViewModel({
        conversations: [{ id: "conv-1", title: "Test", updatedAt: "2026-08-30", selected: true }],
      });
      target.paint(viewModel);

      const promptInput = root.querySelector('[data-testid="prompt-input"]') as any;
      promptInput.value = "   ";

      const sendBtn = root.querySelector('[data-testid="send"]') as any;
      sendBtn.dispatchEvent(new win.Event("click"));

      expect(calls.length).toBe(0);
      expect(promptInput.value).toBe("   ");
      expect(notices).toHaveLength(1);
      expect((notices[0] ?? "").toLowerCase()).toContain("prompt");
    });

    it("send with no selected conversation makes no action call and says why via setNotice", async () => {
      const { win, doc, root } = createTestWindow();
      const target = createDomTarget(root as any);
      const { actions, calls } = createRecordingActions();

      const notices: (string | null)[] = [];
      const controller: DomController = {
        render: () => {},
        select: () => {},
        setGeneration: () => {},
        setStreamingText: () => {},
        setProfiles: () => {},
        setNotice: (notice) => notices.push(notice),
      };

      target.attach({ actions, controller });

      const viewModel = createTestViewModel({
        conversations: [],
      });
      target.paint(viewModel);

      const promptInput = root.querySelector('[data-testid="prompt-input"]') as any;
      promptInput.value = "hello";

      const sendBtn = root.querySelector('[data-testid="send"]') as any;
      sendBtn.dispatchEvent(new win.Event("click"));

      expect(calls.length).toBe(0);
      expect(notices).toHaveLength(1);
      expect((notices[0] ?? "").toLowerCase()).toContain("conversation");
    });

    it("cancel button dispatches actions.cancel with selected conversation id", async () => {
      const { win, doc, root } = createTestWindow();
      const target = createDomTarget(root as any);
      const { actions, calls } = createRecordingActions();

      const controller: DomController = {
        render: () => {},
        select: () => {},
        setGeneration: () => {},
        setStreamingText: () => {},
        setProfiles: () => {},
        setNotice: () => {},
      };

      target.attach({ actions, controller });

      const viewModel = createTestViewModel({
        conversations: [{ id: "conv-1", title: "Test", updatedAt: "2026-08-30", selected: true }],
      });
      target.paint(viewModel);

      const cancelBtn = root.querySelector('[data-testid="cancel"]') as any;
      cancelBtn.dispatchEvent(new win.Event("click"));

      expect(calls.length).toBe(1);
      expect(calls[0]?.method).toBe("cancel");
      expect(calls[0]?.args[0]).toBe("conv-1");
    });

    it("cancel with no selected conversation makes no action call and says why via setNotice", async () => {
      const { win, doc, root } = createTestWindow();
      const target = createDomTarget(root as any);
      const { actions, calls } = createRecordingActions();

      const notices: (string | null)[] = [];
      const controller: DomController = {
        render: () => {},
        select: () => {},
        setGeneration: () => {},
        setStreamingText: () => {},
        setProfiles: () => {},
        setNotice: (notice) => notices.push(notice),
      };

      target.attach({ actions, controller });

      const viewModel = createTestViewModel();
      target.paint(viewModel);

      const cancelBtn = root.querySelector('[data-testid="cancel"]') as any;
      cancelBtn.dispatchEvent(new win.Event("click"));

      expect(calls.length).toBe(0);
      expect(notices).toHaveLength(1);
      expect((notices[0] ?? "").toLowerCase()).toContain("conversation");
    });

    it("profile-select change dispatches actions.chooseProfile", async () => {
      const { win, doc, root } = createTestWindow();
      const target = createDomTarget(root as any);
      const { actions, calls } = createRecordingActions();

      const controller: DomController = {
        render: () => {},
        select: () => {},
        setGeneration: () => {},
        setStreamingText: () => {},
        setProfiles: () => {},
        setNotice: () => {},
      };

      target.attach({ actions, controller });

      const profiles: Profile[] = [
        { id: "prof-1", role: "assistant", quality: "high", latency_class: "fast", label: "Profile 1" },
      ];

      const viewModel = createTestViewModel({
        conversations: [{ id: "conv-1", title: "Test", updatedAt: "2026-08-30", selected: true }],
        profiles,
      });
      target.paint(viewModel);

      const profileSelect = root.querySelector('[data-testid="profile-select"]') as any;
      profileSelect.value = "prof-1";
      profileSelect.dispatchEvent(new win.Event("change"));

      expect(calls.length).toBe(1);
      expect(calls[0]?.method).toBe("chooseProfile");
      expect(calls[0]?.args[0]).toBe("conv-1");
      expect(calls[0]?.args[1]).toBe("prof-1");
    });

    it("profile-select change with no selected conversation makes no action call and says why via setNotice", async () => {
      const { win, doc, root } = createTestWindow();
      const target = createDomTarget(root as any);
      const { actions, calls } = createRecordingActions();

      const notices: (string | null)[] = [];
      const controller: DomController = {
        render: () => {},
        select: () => {},
        setGeneration: () => {},
        setStreamingText: () => {},
        setProfiles: () => {},
        setNotice: (notice) => notices.push(notice),
      };

      target.attach({ actions, controller });

      const profiles: Profile[] = [
        { id: "prof-1", role: "assistant", quality: "high", latency_class: "fast", label: "Profile 1" },
      ];

      const viewModel = createTestViewModel({ profiles });
      target.paint(viewModel);

      const profileSelect = root.querySelector('[data-testid="profile-select"]') as any;
      profileSelect.value = "prof-1";
      profileSelect.dispatchEvent(new win.Event("change"));

      expect(calls.length).toBe(0);
      expect(notices).toHaveLength(1);
      expect((notices[0] ?? "").toLowerCase()).toContain("conversation");
    });

    it("create-conversation button with empty profile selector makes no action call and points at re-pairing via setNotice", async () => {
      const { win, doc, root } = createTestWindow();
      const target = createDomTarget(root as any);
      const { actions, calls } = createRecordingActions();

      const notices: (string | null)[] = [];
      const controller: DomController = {
        render: () => {},
        select: () => {},
        setGeneration: () => {},
        setStreamingText: () => {},
        setProfiles: () => {},
        setNotice: (notice) => notices.push(notice),
      };

      target.attach({ actions, controller });

      const viewModel = createTestViewModel({ profiles: [] });
      target.paint(viewModel);

      const createBtn = root.querySelector('[data-testid="create-conversation"]') as any;
      createBtn.dispatchEvent(new win.Event("click"));

      expect(calls.length).toBe(0);
      expect(notices).toHaveLength(1);
      const message = (notices[0] ?? "").toLowerCase();
      // This is the unpaired case the human hit: an empty profile list
      // signals the phone is not paired, so the message must point at
      // re-pairing rather than just "pick a profile".
      expect(message).toContain("pair");
      expect(message).toContain("qr");
    });

    it("create-conversation button dispatches actions.createConversation with profile id", async () => {
      const { win, doc, root } = createTestWindow();
      const target = createDomTarget(root as any);
      const { actions, calls } = createRecordingActions();

      const controller: DomController = {
        render: () => {},
        select: () => {},
        setGeneration: () => {},
        setStreamingText: () => {},
        setProfiles: () => {},
        setNotice: () => {},
      };

      target.attach({ actions, controller });

      const profiles: Profile[] = [
        { id: "prof-1", role: "assistant", quality: "high", latency_class: "fast", label: "Profile 1" },
      ];

      const viewModel = createTestViewModel({ profiles });
      target.paint(viewModel);

      const profileSelect = root.querySelector('[data-testid="profile-select"]') as any;
      profileSelect.value = "prof-1";

      const createBtn = root.querySelector('[data-testid="create-conversation"]') as any;
      createBtn.dispatchEvent(new win.Event("click"));

      expect(calls.length).toBe(1);
      expect(calls[0]?.method).toBe("createConversation");
      expect(calls[0]?.args[0]).toEqual({ profileId: "prof-1" });
    });

    it("open-conversation button dispatches controller.select", async () => {
      const { win, doc, root } = createTestWindow();
      const target = createDomTarget(root as any);
      const { actions } = createRecordingActions();

      const controllerCalls: any[] = [];
      const controller: DomController = {
        render: () => {},
        select: (id) => controllerCalls.push({ method: "select", args: [id] }),
        setGeneration: () => {},
        setStreamingText: () => {},
        setProfiles: () => {},
        setNotice: () => {},
      };

      target.attach({ actions, controller });

      const viewModel = createTestViewModel({
        conversations: [
          { id: "conv-1", title: "Test 1", updatedAt: "2026-08-30", selected: true },
          { id: "conv-2", title: "Test 2", updatedAt: "2026-08-31", selected: false },
        ],
      });
      target.paint(viewModel);

      const openBtns = root.querySelectorAll('[data-testid="open-conversation"]') as any;
      expect(openBtns.length).toBe(2);

      // Click the second button
      openBtns[1].dispatchEvent(new win.Event("click"));

      expect(controllerCalls.length).toBe(1);
      expect(controllerCalls[0]?.method).toBe("select");
      expect(controllerCalls[0]?.args[0]).toBe("conv-2");
    });

    it("delete-conversation button dispatches actions.deleteConversation with correct conversation id", async () => {
      const { win, doc, root } = createTestWindow();
      const target = createDomTarget(root as any);
      const { actions, calls } = createRecordingActions();

      const controller: DomController = {
        render: () => {},
        select: () => {},
        setGeneration: () => {},
        setStreamingText: () => {},
        setProfiles: () => {},
        setNotice: () => {},
      };

      target.attach({ actions, controller });

      const viewModel = createTestViewModel({
        conversations: [
          { id: "conv-1", title: "Test 1", updatedAt: "2026-08-30", selected: true },
          { id: "conv-2", title: "Test 2", updatedAt: "2026-08-31", selected: false },
        ],
      });
      target.paint(viewModel);

      const deleteBtns = root.querySelectorAll('[data-testid="delete-conversation"]') as any;
      expect(deleteBtns.length).toBe(2);

      // Click the second button to delete conv-2
      deleteBtns[1].dispatchEvent(new win.Event("click"));

      expect(calls.length).toBe(1);
      expect(calls[0]?.method).toBe("deleteConversation");
      expect(calls[0]?.args[0]).toBe("conv-2");
    });

    it("delete-conversation on second list item passes the second item's id, not the selected one", async () => {
      const { win, doc, root } = createTestWindow();
      const target = createDomTarget(root as any);
      const { actions, calls } = createRecordingActions();

      const controller: DomController = {
        render: () => {},
        select: () => {},
        setGeneration: () => {},
        setStreamingText: () => {},
        setProfiles: () => {},
        setNotice: () => {},
      };

      target.attach({ actions, controller });

      const viewModel = createTestViewModel({
        conversations: [
          { id: "conv-1", title: "Test 1", updatedAt: "2026-08-30", selected: true },
          { id: "conv-2", title: "Test 2", updatedAt: "2026-08-31", selected: false },
          { id: "conv-3", title: "Test 3", updatedAt: "2026-08-29", selected: false },
        ],
      });
      target.paint(viewModel);

      // Find delete button with data-conversation-id="conv-2"
      const deleteBtn = root.querySelector('[data-conversation-id="conv-2"][data-testid="delete-conversation"]') as any;
      expect(deleteBtn).not.toBeNull();

      deleteBtn.dispatchEvent(new win.Event("click"));

      expect(calls.length).toBe(1);
      expect(calls[0]?.method).toBe("deleteConversation");
      expect(calls[0]?.args[0]).toBe("conv-2");
    });

    it("paint() still renders conversation list, transcript, profiles and status text", () => {
      const { win, doc, root } = createTestWindow();
      const target = createDomTarget(root as any);

      const profiles: Profile[] = [
        { id: "prof-1", role: "assistant", quality: "high", latency_class: "fast", label: "Profile 1" },
      ];

      const viewModel = createTestViewModel({
        conversations: [{ id: "conv-1", title: "Test", updatedAt: "2026-08-30", selected: true }],
        transcript: [
          { role: "user", content: "Hello", cancelled: false, createdAt: "2026-08-30T00:00:00Z", pending: false },
          { role: "assistant", content: "Hi", cancelled: false, createdAt: "2026-08-30T00:01:00Z", pending: false },
        ],
        profiles,
        generation: { kind: "complete", telemetry: { tokensPerSecond: 50, evalCount: 100, quantization: "Q4", contextLimit: 4096 } },
      });
      target.paint(viewModel);

      // Check that conversation list is rendered
      const conversationList = root.querySelector('ul');
      expect(conversationList).not.toBeNull();

      // Check that status text contains "Complete"
      const statusText = root.textContent;
      expect(statusText).toContain("Complete");
    });
  });

  describe("GenerationHandlers integration with streaming", () => {
    it("deltas drive setStreamingText incrementally and DOM reflects each one", async () => {
      const { win, doc, root } = createTestWindow();
      const target = createDomTarget(root as any);

      // Create memory storage and conversation store
      const storage = createMemoryStorage();
      const store = createConversationStore(storage);

      // Create a fake coordinator that emits deltas
      const telemetryData: Telemetry = {
        profile_id: "prof-1",
        quantization: "Q4",
        context_limit: 4096,
        total_duration_ns: 1000000000,
        load_duration_ns: 500000000,
        prompt_eval_count: 10,
        eval_count: 20,
        tokens_per_second: 50,
      };

      // Captures the RENDERED DOM's pending-assistant text immediately after
      // each delta is applied, so the assertion below proves the DOM grows
      // delta by delta in order, not just that the view model or store ends
      // up correct.
      const deltaDomSnapshots: (string | null)[] = [];

      const fakeCoordinator: SessionCoordinator = {
        async createConversation(input: { profileId: string; title?: string }) {
          return store.createConversation(input);
        },
        async send(conversationId: string, prompt: string, handlers?: GenerationHandlers): Promise<SendResult> {
          // Simulate delta sequence: "He", "llo", " world"
          handlers?.onDelta?.("He");
          deltaDomSnapshots.push(readPendingAssistantText(root));
          handlers?.onDelta?.("llo");
          deltaDomSnapshots.push(readPendingAssistantText(root));
          handlers?.onDelta?.(" world");
          deltaDomSnapshots.push(readPendingAssistantText(root));
          handlers?.onComplete?.(telemetryData);

          // Append the turns to the store (simulating coordinator behavior)
          store.appendTurn(conversationId, {
            role: "user",
            content: prompt,
            cancelled: false,
            createdAt: new Date().toISOString(),
          });
          store.appendTurn(conversationId, {
            role: "assistant",
            content: "Hello world",
            cancelled: false,
            createdAt: new Date().toISOString(),
          });

          return {
            generationId: "gen-1",
            text: "Hello world",
            status: "complete",
            telemetry: telemetryData,
            errorCode: null,
            streamError: null,
            sessionRebuilt: false,
            replayedTurns: 0,
          };
        },
        async cancel() {
          return { status: "cancelled" };
        },
        async setProfile(conversationId: string, profileId: string) {
          return store.setProfileId(conversationId, profileId);
        },
        async resumeIfInterrupted(): Promise<ResumeResult> {
          return { resumed: false, generationId: null, text: "", status: null, telemetry: null, errorCode: null, streamError: null, reconciledFromSession: false, seqs: [] };
        },
        async listProfiles() {
          return [{ id: "prof-1", role: "assistant", quality: "high", latency_class: "fast", label: "Profile 1" }];
        },
      };

      // Create a conversation
      const conversation = await fakeCoordinator.createConversation({ profileId: "prof-1" });

      // Mount the app with the fake coordinator and real store
      const controller = mount({
        target,
        coordinator: fakeCoordinator,
        store,
        initialState: { selectedConversationId: conversation.id },
      });

      // Attach the controller to the target
      target.attach({ actions: controller.actions, controller });

      // Send the message via DOM event
      const promptInput = root.querySelector('[data-testid="prompt-input"]') as any;
      promptInput.value = "test prompt";

      const sendBtn = root.querySelector('[data-testid="send"]') as any;
      await sendBtn.dispatchEvent(new win.Event("click"));

      // Small delay to ensure all promises settle
      await new Promise(r => setTimeout(r, 10));

      // Check that the RENDERED DOM transcript text grew delta by delta, in
      // order — read directly out of the happy-dom document between deltas,
      // not out of the view model handed to paint() and not out of the store.
      expect(deltaDomSnapshots).toEqual(["He", "Hello", "Hello world"]);

      // Check that the final RENDERED DOM shows the assistant's final text
      // exactly once — proving it is present (not missing, e.g. dropped by a
      // premature render()) and not duplicated (e.g. between the store's
      // persisted turn and a leftover streaming projection).
      const transcriptList = getTranscriptListElement(root);
      const renderedTranscriptText: string = transcriptList?.textContent ?? "";
      const occurrences = (renderedTranscriptText.match(/Hello world/g) || []).length;
      expect(occurrences).toBe(1);
    });

    it("complete drives telemetry rendering in status text", async () => {
      const { win, doc, root } = createTestWindow();
      const target = createDomTarget(root as any);

      const storage = createMemoryStorage();
      const store = createConversationStore(storage);

      const telemetryData2: Telemetry = {
        profile_id: "prof-1",
        quantization: "Q8",
        context_limit: 8192,
        total_duration_ns: 2000000000,
        load_duration_ns: 1000000000,
        prompt_eval_count: 20,
        eval_count: 50,
        tokens_per_second: 100,
      };

      const fakeCoordinator: SessionCoordinator = {
        async createConversation(input: { profileId: string; title?: string }) {
          return store.createConversation(input);
        },
        async send(conversationId: string, prompt: string, handlers?: GenerationHandlers): Promise<SendResult> {
          handlers?.onComplete?.(telemetryData2);

          store.appendTurn(conversationId, {
            role: "user",
            content: prompt,
            cancelled: false,
            createdAt: new Date().toISOString(),
          });
          store.appendTurn(conversationId, {
            role: "assistant",
            content: "Response",
            cancelled: false,
            createdAt: new Date().toISOString(),
          });

          return {
            generationId: "gen-1",
            text: "Response",
            status: "complete",
            telemetry: telemetryData2,
            errorCode: null,
            streamError: null,
            sessionRebuilt: false,
            replayedTurns: 0,
          };
        },
        async cancel() {
          return { status: "cancelled" };
        },
        async setProfile(conversationId: string, profileId: string) {
          return store.setProfileId(conversationId, profileId);
        },
        async resumeIfInterrupted(): Promise<ResumeResult> {
          return { resumed: false, generationId: null, text: "", status: null, telemetry: null, errorCode: null, streamError: null, reconciledFromSession: false, seqs: [] };
        },
        async listProfiles() {
          return [{ id: "prof-1", role: "assistant", quality: "high", latency_class: "fast", label: "Profile 1" }];
        },
      };

      const conversation = await fakeCoordinator.createConversation({ profileId: "prof-1" });

      const controller = mount({
        target,
        coordinator: fakeCoordinator,
        store,
        initialState: { selectedConversationId: conversation.id },
      });

      target.attach({ actions: controller.actions, controller });

      const promptInput = root.querySelector('[data-testid="prompt-input"]') as any;
      promptInput.value = "test prompt";

      const sendBtn = root.querySelector('[data-testid="send"]') as any;
      await sendBtn.dispatchEvent(new win.Event("click"));

      // Small delay to ensure all promises settle
      await new Promise(r => setTimeout(r, 10));

      const state = controller.getState() as any;
      const generation = state.generation;

      expect(generation.kind).toBe("complete");
      expect(generation.telemetry).toBeDefined();
      expect(generation.telemetry.tokensPerSecond).toBe(100);
      expect(generation.telemetry.evalCount).toBe(50);
      expect(generation.telemetry.quantization).toBe("Q8");
      expect(generation.telemetry.contextLimit).toBe(8192);
    });

    it("queued and model-loading render the queue position and loading state", async () => {
      const { win, doc, root } = createTestWindow();
      const target = createDomTarget(root as any);

      const storage = createMemoryStorage();
      const store = createConversationStore(storage);

      const generationStates: any[] = [];

      const telemetryData3: Telemetry = {
        profile_id: "prof-1",
        quantization: "Q4",
        context_limit: 4096,
        total_duration_ns: 1000000000,
        load_duration_ns: 500000000,
        prompt_eval_count: 10,
        eval_count: 20,
        tokens_per_second: 50,
      };

      const fakeCoordinator: SessionCoordinator = {
        async createConversation(input: { profileId: string; title?: string }) {
          return store.createConversation(input);
        },
        async send(conversationId: string, prompt: string, handlers?: GenerationHandlers): Promise<SendResult> {
          handlers?.onQueued?.(3);
          handlers?.onModelLoading?.();
          handlers?.onDelta?.("Response");
          handlers?.onComplete?.(telemetryData3);

          store.appendTurn(conversationId, {
            role: "user",
            content: prompt,
            cancelled: false,
            createdAt: new Date().toISOString(),
          });
          store.appendTurn(conversationId, {
            role: "assistant",
            content: "Response",
            cancelled: false,
            createdAt: new Date().toISOString(),
          });

          return {
            generationId: "gen-1",
            text: "Response",
            status: "complete",
            telemetry: telemetryData3,
            errorCode: null,
            streamError: null,
            sessionRebuilt: false,
            replayedTurns: 0,
          };
        },
        async cancel() {
          return { status: "cancelled" };
        },
        async setProfile(conversationId: string, profileId: string) {
          return store.setProfileId(conversationId, profileId);
        },
        async resumeIfInterrupted(): Promise<ResumeResult> {
          return { resumed: false, generationId: null, text: "", status: null, telemetry: null, errorCode: null, streamError: null, reconciledFromSession: false, seqs: [] };
        },
        async listProfiles() {
          return [{ id: "prof-1", role: "assistant", quality: "high", latency_class: "fast", label: "Profile 1" }];
        },
      };

      const conversation = await fakeCoordinator.createConversation({ profileId: "prof-1" });

      const controller = mount({
        target,
        coordinator: fakeCoordinator,
        store,
        initialState: { selectedConversationId: conversation.id },
      });

      const originalPaint = target.paint.bind(target);
      target.paint = (view) => {
        originalPaint(view);
        generationStates.push(view.generation);
      };

      target.attach({ actions: controller.actions, controller });

      const promptInput = root.querySelector('[data-testid="prompt-input"]') as any;
      promptInput.value = "test prompt";

      const sendBtn = root.querySelector('[data-testid="send"]') as any;
      await sendBtn.dispatchEvent(new win.Event("click"));

      // Small delay to ensure all promises settle
      await new Promise(r => setTimeout(r, 10));

      // Check that queued and model-loading states were rendered
      expect(generationStates.some((g) => g.kind === "queued" && g.position === 3)).toBe(true);
      expect(generationStates.some((g) => g.kind === "model-loading")).toBe(true);
    });

    it("cancelled drives cancellation state and clears streaming text", async () => {
      const { win, doc, root } = createTestWindow();
      const target = createDomTarget(root as any);

      const storage = createMemoryStorage();
      const store = createConversationStore(storage);

      const fakeCoordinator: SessionCoordinator = {
        async createConversation(input: { profileId: string; title?: string }) {
          return store.createConversation(input);
        },
        async send(conversationId: string, prompt: string, handlers?: GenerationHandlers): Promise<SendResult> {
          handlers?.onDelta?.("Partial");
          handlers?.onCancelled?.();

          store.appendTurn(conversationId, {
            role: "user",
            content: prompt,
            cancelled: false,
            createdAt: new Date().toISOString(),
          });
          store.appendTurn(conversationId, {
            role: "assistant",
            content: "Partial",
            cancelled: true,
            createdAt: new Date().toISOString(),
          });

          return {
            generationId: "gen-1",
            text: "Partial",
            status: "cancelled",
            telemetry: null,
            errorCode: null,
            streamError: null,
            sessionRebuilt: false,
            replayedTurns: 0,
          };
        },
        async cancel() {
          return { status: "cancelled" };
        },
        async setProfile(conversationId: string, profileId: string) {
          return store.setProfileId(conversationId, profileId);
        },
        async resumeIfInterrupted(): Promise<ResumeResult> {
          return { resumed: false, generationId: null, text: "", status: null, telemetry: null, errorCode: null, streamError: null, reconciledFromSession: false, seqs: [] };
        },
        async listProfiles() {
          return [{ id: "prof-1", role: "assistant", quality: "high", latency_class: "fast", label: "Profile 1" }];
        },
      };

      const conversation = await fakeCoordinator.createConversation({ profileId: "prof-1" });

      const controller = mount({
        target,
        coordinator: fakeCoordinator,
        store,
        initialState: { selectedConversationId: conversation.id },
      });

      target.attach({ actions: controller.actions, controller });

      const promptInput = root.querySelector('[data-testid="prompt-input"]') as any;
      promptInput.value = "test prompt";

      const sendBtn = root.querySelector('[data-testid="send"]') as any;
      await sendBtn.dispatchEvent(new win.Event("click"));

      // Small delay to ensure all promises settle
      await new Promise(r => setTimeout(r, 10));

      const state = controller.getState() as any;
      expect(state.generation.kind).toBe("cancelled");
      expect(state.streamingText).toBe("");
    });

    it("error drives error state with code and message", async () => {
      const { win, doc, root } = createTestWindow();
      const target = createDomTarget(root as any);

      const storage = createMemoryStorage();
      const store = createConversationStore(storage);

      const fakeCoordinator: SessionCoordinator = {
        async createConversation(input: { profileId: string; title?: string }) {
          return store.createConversation(input);
        },
        async send(conversationId: string, prompt: string, handlers?: GenerationHandlers): Promise<SendResult> {
          const error = new HarnessStreamError("inference_failed");
          handlers?.onError?.("inference_failed", error);

          return {
            generationId: "gen-1",
            text: "",
            status: "error",
            telemetry: null,
            errorCode: "inference_failed",
            streamError: error,
            sessionRebuilt: false,
            replayedTurns: 0,
          };
        },
        async cancel() {
          return { status: "cancelled" };
        },
        async setProfile(conversationId: string, profileId: string) {
          return store.setProfileId(conversationId, profileId);
        },
        async resumeIfInterrupted(): Promise<ResumeResult> {
          return { resumed: false, generationId: null, text: "", status: null, telemetry: null, errorCode: null, streamError: null, reconciledFromSession: false, seqs: [] };
        },
        async listProfiles() {
          return [{ id: "prof-1", role: "assistant", quality: "high", latency_class: "fast", label: "Profile 1" }];
        },
      };

      const conversation = await fakeCoordinator.createConversation({ profileId: "prof-1" });

      const controller = mount({
        target,
        coordinator: fakeCoordinator,
        store,
        initialState: { selectedConversationId: conversation.id },
      });

      target.attach({ actions: controller.actions, controller });

      const promptInput = root.querySelector('[data-testid="prompt-input"]') as any;
      promptInput.value = "test prompt";

      const sendBtn = root.querySelector('[data-testid="send"]') as any;
      await sendBtn.dispatchEvent(new win.Event("click"));

      // Small delay to ensure all promises settle
      await new Promise(r => setTimeout(r, 10));

      const state = controller.getState() as any;
      expect(state.generation.kind).toBe("error");
      expect(state.generation.code).toBe("inference_failed");
      expect(state.generation.message).toBe("Generation stopped because the model itself failed. Send the prompt again.");
    });
  });

  // M12 cycle-1 BLOCKER 1 corrections: creating and deleting a conversation
  // must repaint the real, mounted UI on their own -- no caller may compensate
  // by invoking render()/select() by hand. These tests use the real mount()
  // and a real store (not a no-op recording controller), so a paint the app
  // itself never performs shows up as a missing button, not a passing no-op.
  describe("create/delete repaint the mounted UI without manual render()/select()", () => {
    it("create-conversation click repaints the list, selects the new conversation, and Send works immediately with no other clicks", async () => {
      const { win, doc, root } = createTestWindow();
      const target = createDomTarget(root as any);
      const storage = createMemoryStorage();
      const store = createConversationStore(storage);

      const sendCalls: { conversationId: string; prompt: string }[] = [];

      const fakeCoordinator: SessionCoordinator = {
        async createConversation(input: { profileId: string; title?: string }) {
          return store.createConversation(input);
        },
        async send(conversationId: string, prompt: string, handlers?: GenerationHandlers): Promise<SendResult> {
          sendCalls.push({ conversationId, prompt });
          return {
            generationId: "gen-1",
            text: "ok",
            status: "complete",
            telemetry: null,
            errorCode: null,
            streamError: null,
            sessionRebuilt: false,
            replayedTurns: 0,
          };
        },
        async cancel() {
          return { status: "cancelled" };
        },
        async setProfile(conversationId: string, profileId: string) {
          return store.setProfileId(conversationId, profileId);
        },
        async resumeIfInterrupted(): Promise<ResumeResult> {
          return { resumed: false, generationId: null, text: "", status: null, telemetry: null, errorCode: null, streamError: null, reconciledFromSession: false, seqs: [] };
        },
        async listProfiles() {
          return [{ id: "prof-1", role: "assistant", quality: "high", latency_class: "fast", label: "Profile 1" }];
        },
      };

      const controller = mount({ target, coordinator: fakeCoordinator, store });
      target.attach({ actions: controller.actions, controller });

      controller.setProfiles([{ id: "prof-1", role: "assistant", quality: "high", latency_class: "fast", label: "Profile 1" }]);

      const profileSelect = root.querySelector('[data-testid="profile-select"]') as any;
      profileSelect.value = "prof-1";

      // Before creating: no open-conversation button exists at all.
      expect(root.querySelectorAll('[data-testid="open-conversation"]').length).toBe(0);

      const createBtn = root.querySelector('[data-testid="create-conversation"]') as any;
      createBtn.dispatchEvent(new win.Event("click"));

      // Let the create -> render -> select promise chain settle. No caller
      // here invokes render() or select() itself.
      await new Promise((resolve) => setTimeout(resolve, 0));

      const openBtns = root.querySelectorAll('[data-testid="open-conversation"]') as any;
      expect(openBtns.length).toBe(1);
      expect((openBtns[0] as any).textContent).toContain("▸");
      expect(controller.getState().selectedConversationId).not.toBeNull();

      // Immediately after, with no click on open-conversation, Send must work.
      const promptInput = root.querySelector('[data-testid="prompt-input"]') as any;
      promptInput.value = "hello";
      const sendBtn = root.querySelector('[data-testid="send"]') as any;
      sendBtn.dispatchEvent(new win.Event("click"));

      const selectedId = controller.getState().selectedConversationId;
      expect(selectedId).not.toBeNull();
      expect(sendCalls.length).toBe(1);
      expect(sendCalls[0]?.conversationId).toBe(selectedId as string);
      expect(sendCalls[0]?.prompt).toBe("hello");
    });

    it("delete-conversation click on the selected conversation clears selection and repaints the list", () => {
      const { win, doc, root } = createTestWindow();
      const target = createDomTarget(root as any);
      const storage = createMemoryStorage();
      const store = createConversationStore(storage);

      const conv1 = store.createConversation({ profileId: "prof-1" });
      const conv2 = store.createConversation({ profileId: "prof-1" });

      const fakeCoordinator: SessionCoordinator = {
        async createConversation(input: { profileId: string; title?: string }) {
          return store.createConversation(input);
        },
        async send(): Promise<SendResult> {
          throw new Error("not used in this test");
        },
        async cancel() {
          return { status: "cancelled" };
        },
        async setProfile(conversationId: string, profileId: string) {
          return store.setProfileId(conversationId, profileId);
        },
        async resumeIfInterrupted(): Promise<ResumeResult> {
          return { resumed: false, generationId: null, text: "", status: null, telemetry: null, errorCode: null, streamError: null, reconciledFromSession: false, seqs: [] };
        },
        async listProfiles() {
          return [];
        },
      };

      const controller = mount({
        target,
        coordinator: fakeCoordinator,
        store,
        initialState: { selectedConversationId: conv1.id },
      });
      target.attach({ actions: controller.actions, controller });

      expect(root.querySelectorAll('[data-testid="open-conversation"]').length).toBe(2);

      const deleteBtn = root.querySelector(
        `[data-conversation-id="${conv1.id}"][data-testid="delete-conversation"]`
      ) as any;
      expect(deleteBtn).not.toBeNull();
      deleteBtn.dispatchEvent(new win.Event("click"));

      // deleteConversation is synchronous, and the dom-target handler calls
      // select()/render() synchronously too -- no wait needed.
      expect(controller.getState().selectedConversationId).toBeNull();

      const remainingOpenBtns = root.querySelectorAll('[data-testid="open-conversation"]') as any;
      expect(remainingOpenBtns.length).toBe(1);
      expect((remainingOpenBtns[0] as any).getAttribute("data-conversation-id")).toBe(conv2.id);

      const remainingDeleteBtns = root.querySelectorAll('[data-testid="delete-conversation"]') as any;
      expect(remainingDeleteBtns.length).toBe(1);
    });
  });

  describe("BLOCKER 2 correction: failures and refusals reach the notice region", () => {
    it("a rejected send puts a guidance-derived message into [data-testid=\"notice\"] and clears stale streaming text", async () => {
      const { win, doc, root } = createTestWindow();
      const target = createDomTarget(root as any);
      const storage = createMemoryStorage();
      const store = createConversationStore(storage);
      const conv = store.createConversation({ profileId: "prof-1" });

      const fakeCoordinator: SessionCoordinator = {
        async createConversation(input: { profileId: string; title?: string }) {
          return store.createConversation(input);
        },
        async send(_conversationId: string, _prompt: string, handlers?: GenerationHandlers): Promise<SendResult> {
          // Emit a delta before failing, so the test can prove the stale
          // streaming text is cleared once the rejection is handled.
          handlers?.onDelta?.("partial reply");
          throw new HarnessApiError("unauthorized", 401, null);
        },
        async cancel() {
          return { status: "cancelled" };
        },
        async setProfile(conversationId: string, profileId: string) {
          return store.setProfileId(conversationId, profileId);
        },
        async resumeIfInterrupted(): Promise<ResumeResult> {
          return { resumed: false, generationId: null, text: "", status: null, telemetry: null, errorCode: null, streamError: null, reconciledFromSession: false, seqs: [] };
        },
        async listProfiles() {
          return [];
        },
      };

      const controller = mount({
        target,
        coordinator: fakeCoordinator,
        store,
        initialState: { selectedConversationId: conv.id },
      });
      target.attach({ actions: controller.actions, controller });

      const promptInput = root.querySelector('[data-testid="prompt-input"]') as any;
      promptInput.value = "hello";
      const sendBtn = root.querySelector('[data-testid="send"]') as any;
      sendBtn.dispatchEvent(new win.Event("click"));

      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(controller.getState().streamingText).toBe("");

      const noticeEl = root.querySelector('[data-testid="notice"]') as any;
      expect(noticeEl).not.toBeNull();
      const noticeText = (noticeEl?.textContent ?? "") as string;
      expect(noticeText).toContain("unauthorized");
      expect(noticeText.toLowerCase()).toContain("pair");
      expect(noticeText.toLowerCase()).toContain("scan");
    });

    it("a rejected create-conversation puts a guidance-derived message into [data-testid=\"notice\"]", async () => {
      const { win, doc, root } = createTestWindow();
      const target = createDomTarget(root as any);
      const storage = createMemoryStorage();
      const store = createConversationStore(storage);

      const fakeCoordinator: SessionCoordinator = {
        async createConversation(_input: { profileId: string; title?: string }): Promise<Conversation> {
          throw new HarnessApiError("internal_error", 500, null);
        },
        async send(): Promise<SendResult> {
          throw new Error("not used in this test");
        },
        async cancel() {
          return { status: "cancelled" };
        },
        async setProfile(conversationId: string, profileId: string) {
          return store.setProfileId(conversationId, profileId);
        },
        async resumeIfInterrupted(): Promise<ResumeResult> {
          return { resumed: false, generationId: null, text: "", status: null, telemetry: null, errorCode: null, streamError: null, reconciledFromSession: false, seqs: [] };
        },
        async listProfiles() {
          return [{ id: "prof-1", role: "assistant", quality: "high", latency_class: "fast", label: "Profile 1" }];
        },
      };

      const controller = mount({ target, coordinator: fakeCoordinator, store });
      target.attach({ actions: controller.actions, controller });
      controller.setProfiles([{ id: "prof-1", role: "assistant", quality: "high", latency_class: "fast", label: "Profile 1" }]);

      const profileSelect = root.querySelector('[data-testid="profile-select"]') as any;
      profileSelect.value = "prof-1";

      const createBtn = root.querySelector('[data-testid="create-conversation"]') as any;
      createBtn.dispatchEvent(new win.Event("click"));

      await new Promise((resolve) => setTimeout(resolve, 0));

      const noticeEl = root.querySelector('[data-testid="notice"]') as any;
      expect(noticeEl).not.toBeNull();
      const noticeText = (noticeEl?.textContent ?? "") as string;
      expect(noticeText).toContain("internal_error");
    });

    it("paint() renders view.notice into the notice section, and an empty notice renders as empty text", () => {
      const { win, doc, root } = createTestWindow();
      const target = createDomTarget(root as any);

      target.paint(createTestViewModel({ notice: "Something went wrong." }));
      const noticeEl = root.querySelector('[data-testid="notice"]') as any;
      expect(noticeEl).not.toBeNull();
      expect(noticeEl?.textContent).toBe("Something went wrong.");

      target.paint(createTestViewModel({ notice: null }));
      expect(noticeEl?.textContent).toBe("");
    });
  });

  it("render button renders prompt input and send control", () => {
    const { win, doc, root } = createTestWindow();
    const target = createDomTarget(root as any);

    const viewModel = createTestViewModel();
    target.paint(viewModel);

    const promptInput = root.querySelector('[data-testid="prompt-input"]');
    const sendBtn = root.querySelector('[data-testid="send"]');

    expect(promptInput).not.toBeNull();
    expect(sendBtn).not.toBeNull();
    expect(promptInput?.tagName).toBe("TEXTAREA");
    expect(sendBtn?.tagName).toBe("BUTTON");
  });

  it("render includes all required data-testid controls", () => {
    const { win, doc, root } = createTestWindow();
    const target = createDomTarget(root as any);

    const viewModel = createTestViewModel({
      conversations: [{ id: "conv-1", title: "Test", updatedAt: "2026-08-30", selected: true }],
    });
    target.paint(viewModel);

    const controls = [
      "prompt-input",
      "send",
      "cancel",
      "profile-select",
      "create-conversation",
      "open-conversation",
      "delete-conversation",
    ];

    for (const testId of controls) {
      const element = root.querySelector(`[data-testid="${testId}"]`);
      expect(element).not.toBeNull();
    }
  });

  describe("M12b-T1: profile change handler repaints and catches errors", () => {
    it("Test A: (AC1) profile change is reflected in the DOM with no further user action", async () => {
      const { win, doc, root } = createTestWindow();
      const target = createDomTarget(root as any);

      const storage = createMemoryStorage();
      const store = createConversationStore(storage);

      // Create a conversation whose profileId is profile A
      const conv = store.createConversation({ profileId: "prof-a" });

      // Use real createSessionCoordinator with minimal apiClient stub
      const minimalApiClient: any = {
        createSession: async () => "session-1",
        resumeEvents: async () => ({ events: [] }),
        listProfiles: async () => [],
        createSessionWithProfiles: async () => ({ id: "session-1", profiles: [] }),
      };

      const coordinator = createSessionCoordinator({ apiClient: minimalApiClient, conversationStore: store });
      const handle = mount({
        target,
        coordinator,
        store,
        initialState: { selectedConversationId: conv.id },
      });

      target.attach({ actions: handle.actions, controller: handle });
      handle.setProfiles([
        { id: "prof-a", role: "assistant", quality: "high", latency_class: "fast", label: "Profile A" },
        { id: "prof-b", role: "assistant", quality: "high", latency_class: "fast", label: "Profile B" },
      ]);
      handle.render();

      // Dispatch change event with profile B's id on the profile-select
      const profileSelect = root.querySelector('[data-testid="profile-select"]') as any;
      expect(profileSelect).not.toBeNull();

      profileSelect.value = "prof-b";
      profileSelect.dispatchEvent(new win.Event("change"));

      // The change handler's promise resolves on a microtask, so await a tick
      await new Promise((r) => setTimeout(r, 0));

      // Check that the select's selected option has value === "prof-b"
      const selectedOption = Array.from(profileSelect.querySelectorAll("option"))
        .find((opt: any) => opt.selected);
      expect(selectedOption).not.toBeNull();
      expect((selectedOption as any).value).toBe("prof-b");

      // Check that the profiles list shows "(selected)" against Profile B and NOT against Profile A
      const profilesList = root.querySelectorAll("ul")[2] as any; // profiles list is the 3rd ul
      const profileItems: string[] = Array.from(profilesList.querySelectorAll("li")).map((li: any) => li.textContent);
      expect(profileItems).toContain("Profile B (selected)");
      expect(profileItems).toContain("Profile A");
      // Ensure Profile A doesn't show "(selected)"
      const profileAItem = profileItems.find((item) => item.includes("Profile A"));
      expect(profileAItem).toBe("Profile A");
    });

    it("Test B: (AC2) the chosen profile persists across a remount", async () => {
      const { win, doc, root } = createTestWindow();

      const storage = createMemoryStorage();
      const store = createConversationStore(storage);

      // Create a conversation whose profileId is profile A
      const conv = store.createConversation({ profileId: "prof-a" });

      // Use real createSessionCoordinator with minimal apiClient stub
      const minimalApiClient: any = {
        createSession: async () => "session-1",
        resumeEvents: async () => ({ events: [] }),
        listProfiles: async () => [],
        createSessionWithProfiles: async () => ({ id: "session-1", profiles: [] }),
      };

      const coordinator = createSessionCoordinator({ apiClient: minimalApiClient, conversationStore: store });

      // First mount: change the profile
      const target1 = createDomTarget(root as any);
      const handle1 = mount({
        target: target1,
        coordinator,
        store,
        initialState: { selectedConversationId: conv.id },
      });

      target1.attach({ actions: handle1.actions, controller: handle1 });
      handle1.setProfiles([
        { id: "prof-a", role: "assistant", quality: "high", latency_class: "fast", label: "Profile A" },
        { id: "prof-b", role: "assistant", quality: "high", latency_class: "fast", label: "Profile B" },
      ]);
      handle1.render();

      const profileSelect1 = root.querySelector('[data-testid="profile-select"]') as any;
      profileSelect1.value = "prof-b";
      profileSelect1.dispatchEvent(new win.Event("change"));

      // Wait for the promise to settle
      await new Promise((r) => setTimeout(r, 0));

      // Now remount against the SAME storage
      const root2 = doc.createElement("div");
      const target2 = createDomTarget(root2 as any);

      // Create a NEW store instance but using the SAME storage
      const store2 = createConversationStore(storage);
      const coordinator2 = createSessionCoordinator({ apiClient: minimalApiClient, conversationStore: store2 });

      const handle2 = mount({
        target: target2,
        coordinator: coordinator2,
        store: store2,
        initialState: { selectedConversationId: conv.id },
      });

      target2.attach({ actions: handle2.actions, controller: handle2 });
      handle2.setProfiles([
        { id: "prof-a", role: "assistant", quality: "high", latency_class: "fast", label: "Profile A" },
        { id: "prof-b", role: "assistant", quality: "high", latency_class: "fast", label: "Profile B" },
      ]);
      handle2.render();

      // Check that the newly mounted select shows profile B selected
      const profileSelect2 = root2.querySelector('[data-testid="profile-select"]') as any;
      const selectedOption2 = Array.from(profileSelect2.querySelectorAll("option"))
        .find((opt: any) => opt.selected);
      expect(selectedOption2).not.toBeNull();
      expect((selectedOption2 as any).value).toBe("prof-b");
    });

    it("Test C: (AC3) a failing chooseProfile reaches the notice region", async () => {
      const { win, doc, root } = createTestWindow();

      const storage = createMemoryStorage();
      const store = createConversationStore(storage);
      const conv = store.createConversation({ profileId: "prof-a" });

      // Create actions that reject on chooseProfile
      const failingActions: UiActions = {
        async send(conversationId, prompt, handlers) {
          return {
            generationId: "gen-1",
            text: "response",
            status: "complete",
            telemetry: null,
            errorCode: null,
            streamError: null,
            sessionRebuilt: false,
            replayedTurns: 0,
          };
        },
        async cancel(conversationId) {
          return { status: "cancelled" };
        },
        async chooseProfile(conversationId, profileId) {
          // Reject with a HarnessApiError so describeError can process it
          throw new HarnessApiError("profile_error", 400, null);
        },
        async resumeIfInterrupted(conversationId, handlers) {
          return {
            resumed: false,
            generationId: "gen-1",
            text: "",
            status: "complete",
            telemetry: null,
            errorCode: null,
            streamError: null,
            reconciledFromSession: false,
            seqs: [],
          };
        },
        async listProfiles() {
          return [];
        },
        async createConversation(input) {
          return {
            id: "conv-new",
            title: input.title || "New Conversation",
            sessionId: null,
            profileId: input.profileId,
            turns: [],
            pending: null,
            createdAt: "2026-08-30T00:00:00Z",
            updatedAt: "2026-08-30T00:00:00Z",
          };
        },
        deleteConversation(conversationId) {
          // no-op
        },
      };

      const minimalApiClient: any = {
        createSession: async () => "session-1",
        resumeEvents: async () => ({ events: [] }),
        listProfiles: async () => [],
        createSessionWithProfiles: async () => ({ id: "session-1", profiles: [] }),
      };

      const coordinator = createSessionCoordinator({ apiClient: minimalApiClient, conversationStore: store });
      const target = createDomTarget(root as any);
      const handle = mount({
        target,
        coordinator,
        store,
        initialState: { selectedConversationId: conv.id },
      });

      // Override with failing actions
      target.attach({ actions: failingActions, controller: handle });
      handle.setProfiles([
        { id: "prof-a", role: "assistant", quality: "high", latency_class: "fast", label: "Profile A" },
        { id: "prof-b", role: "assistant", quality: "high", latency_class: "fast", label: "Profile B" },
      ]);
      handle.render();

      const profileSelect = root.querySelector('[data-testid="profile-select"]') as any;
      profileSelect.value = "prof-b";
      profileSelect.dispatchEvent(new win.Event("change"));

      // Wait for the promise to settle
      await new Promise((r) => setTimeout(r, 0));

      // Check that the notice region has non-empty text containing the error description
      const noticeEl = root.querySelector('[data-testid="notice"]') as any;
      expect(noticeEl).not.toBeNull();
      const noticeText = (noticeEl?.textContent ?? "") as string;
      expect(noticeText).not.toBe("");
      // The error should contain the code "profile_error"
      expect(noticeText).toContain("profile_error");
    });

    it("Test D: (AC3) a failing cancel reaches the notice region", async () => {
      const { win, doc, root } = createTestWindow();

      const storage = createMemoryStorage();
      const store = createConversationStore(storage);
      const conv = store.createConversation({ profileId: "prof-a" });

      // Create actions that reject on cancel
      const failingActions: UiActions = {
        async send(conversationId, prompt, handlers) {
          return {
            generationId: "gen-1",
            text: "response",
            status: "complete",
            telemetry: null,
            errorCode: null,
            streamError: null,
            sessionRebuilt: false,
            replayedTurns: 0,
          };
        },
        async cancel(conversationId) {
          // Reject with a HarnessApiError
          throw new HarnessApiError("cancel_error", 400, null);
        },
        async chooseProfile(conversationId, profileId) {
          return {
            id: conv.id,
            title: "Test",
            sessionId: null,
            profileId,
            turns: [],
            pending: null,
            createdAt: "2026-08-30T00:00:00Z",
            updatedAt: "2026-08-30T00:00:00Z",
          };
        },
        async resumeIfInterrupted(conversationId, handlers) {
          return {
            resumed: false,
            generationId: "gen-1",
            text: "",
            status: "complete",
            telemetry: null,
            errorCode: null,
            streamError: null,
            reconciledFromSession: false,
            seqs: [],
          };
        },
        async listProfiles() {
          return [];
        },
        async createConversation(input) {
          return {
            id: "conv-new",
            title: input.title || "New Conversation",
            sessionId: null,
            profileId: input.profileId,
            turns: [],
            pending: null,
            createdAt: "2026-08-30T00:00:00Z",
            updatedAt: "2026-08-30T00:00:00Z",
          };
        },
        deleteConversation(conversationId) {
          // no-op
        },
      };

      const minimalApiClient: any = {
        createSession: async () => "session-1",
        resumeEvents: async () => ({ events: [] }),
        listProfiles: async () => [],
        createSessionWithProfiles: async () => ({ id: "session-1", profiles: [] }),
      };

      const coordinator = createSessionCoordinator({ apiClient: minimalApiClient, conversationStore: store });
      const target = createDomTarget(root as any);
      const handle = mount({
        target,
        coordinator,
        store,
        initialState: { selectedConversationId: conv.id },
      });

      target.attach({ actions: failingActions, controller: handle });
      handle.setProfiles([
        { id: "prof-a", role: "assistant", quality: "high", latency_class: "fast", label: "Profile A" },
      ]);
      handle.render();

      // Click the cancel button
      const cancelBtn = root.querySelector('[data-testid="cancel"]') as any;
      cancelBtn.dispatchEvent(new win.Event("click"));

      // Wait for the promise to settle
      await new Promise((r) => setTimeout(r, 0));

      // Check that the notice region has non-empty text containing the error description
      const noticeEl = root.querySelector('[data-testid="notice"]') as any;
      expect(noticeEl).not.toBeNull();
      const noticeText = (noticeEl?.textContent ?? "") as string;
      expect(noticeText).not.toBe("");
      // The error should contain the code "cancel_error"
      expect(noticeText).toContain("cancel_error");
    });
  });

  // M13-T1: a transport failure (the harness is unreachable) must render a
  // distinct offline state, must not clear the drafted prompt, and must not
  // silently drop a turn locally. The failure below is injected at the
  // network layer -- a real createApiClient with a fetch that rejects the
  // way a dead network does (a thrown TypeError), driving the real
  // createSessionCoordinator -- specifically so this proves the offline
  // path a fabricated `{code: "offline"}` response could not prove.
  describe("M13-T1: distinct offline state, preserved draft, no lost turns", () => {
    it("a transport failure renders a dedicated offline element with no harness error code, and leaves status/notice generic", async () => {
      const { win, doc, root } = createTestWindow();
      const target = createDomTarget(root as any);

      const storage = createMemoryStorage();
      const store = createConversationStore(storage);
      const conv = store.createConversation({ profileId: "prof-1" });

      const rejectingFetch = async (): Promise<Response> => {
        throw new TypeError("Failed to fetch");
      };
      const apiClient = createApiClient({
        baseUrl: "http://localhost:8080",
        getToken: () => "test-token-123",
        fetch: rejectingFetch as unknown as typeof fetch,
      });
      const coordinator = createSessionCoordinator({ apiClient, conversationStore: store });

      const controller = mount({
        target,
        coordinator,
        store,
        initialState: { selectedConversationId: conv.id },
      });
      target.attach({ actions: controller.actions, controller });

      const promptInput = root.querySelector('[data-testid="prompt-input"]') as any;
      promptInput.value = "hello from offline test";
      const sendBtn = root.querySelector('[data-testid="send"]') as any;
      sendBtn.dispatchEvent(new win.Event("click"));

      await new Promise((resolve) => setTimeout(resolve, 0));

      const offlineEl = root.querySelector('[data-testid="offline"]') as any;
      expect(offlineEl).not.toBeNull();
      const offlineText = (offlineEl?.textContent ?? "") as string;
      expect(offlineText.length).toBeGreaterThan(0);
      expect(offlineText).not.toContain("offline_");
      expect(offlineText).not.toContain("Mac's harness did not answer");
      expect(offlineText.toLowerCase()).toContain("mac");
      expect(offlineText.toLowerCase()).toContain("kept");

      // Must not be the generic error/notice surface.
      const statusEl = root.querySelector('[data-testid="status"]') as any;
      expect((statusEl?.textContent ?? "")).not.toContain("Error (offline)");
      const noticeEl = root.querySelector('[data-testid="notice"]') as any;
      expect((noticeEl?.textContent ?? "")).toBe("");

      // The drafted prompt must survive exactly.
      expect(promptInput.value).toBe("hello from offline test");

      // A retry control must be present.
      const retryBtn = root.querySelector('[data-testid="retry"]') as any;
      expect(retryBtn).not.toBeNull();
    });

    it("a failed send at the transport layer leaves no user turn and no assistant turn in the local transcript", async () => {
      const { win, doc, root } = createTestWindow();
      const target = createDomTarget(root as any);

      const storage = createMemoryStorage();
      const store = createConversationStore(storage);
      const conv = store.createConversation({ profileId: "prof-1" });

      const beforeTurns = [...(store.getConversation(conv.id)?.turns ?? [])];

      const rejectingFetch = async (): Promise<Response> => {
        throw new TypeError("Failed to fetch");
      };
      const apiClient = createApiClient({
        baseUrl: "http://localhost:8080",
        getToken: () => "test-token-123",
        fetch: rejectingFetch as unknown as typeof fetch,
      });
      const coordinator = createSessionCoordinator({ apiClient, conversationStore: store });

      const controller = mount({
        target,
        coordinator,
        store,
        initialState: { selectedConversationId: conv.id },
      });
      target.attach({ actions: controller.actions, controller });

      const promptInput = root.querySelector('[data-testid="prompt-input"]') as any;
      promptInput.value = "this must not be lost";
      const sendBtn = root.querySelector('[data-testid="send"]') as any;
      sendBtn.dispatchEvent(new win.Event("click"));

      await new Promise((resolve) => setTimeout(resolve, 0));

      const afterTurns = store.getConversation(conv.id)?.turns ?? [];
      expect(afterTurns.length).toBe(beforeTurns.length);
      expect(afterTurns).toEqual(beforeTurns);
    });

    it("clicking retry re-sends the preserved draft with the same conversation id and prompt, and a successful retry clears the input and reaches complete", async () => {
      const { win, doc, root } = createTestWindow();
      const target = createDomTarget(root as any);

      const storage = createMemoryStorage();
      const store = createConversationStore(storage);
      const conv = store.createConversation({ profileId: "prof-1" });

      const sendCalls: Array<{ conversationId: string; prompt: string }> = [];
      let attempt = 0;

      const telemetryData: Telemetry = {
        profile_id: "prof-1",
        quantization: "Q4",
        context_limit: 4096,
        total_duration_ns: 1000000000,
        load_duration_ns: 500000000,
        prompt_eval_count: 10,
        eval_count: 20,
        tokens_per_second: 50,
      };

      const fakeCoordinator: SessionCoordinator = {
        async createConversation(input: { profileId: string; title?: string }) {
          return store.createConversation(input);
        },
        async send(conversationId: string, prompt: string, handlers?: GenerationHandlers): Promise<SendResult> {
          sendCalls.push({ conversationId, prompt });
          attempt++;
          if (attempt === 1) {
            const offlineError = new HarnessOfflineError("http://localhost:8080/v1/generate", new TypeError("Failed to fetch"));
            offlineError.draftPrompt = prompt;
            throw offlineError;
          }
          handlers?.onComplete?.(telemetryData);
          store.appendTurn(conversationId, {
            role: "user",
            content: prompt,
            cancelled: false,
            createdAt: new Date().toISOString(),
          });
          store.appendTurn(conversationId, {
            role: "assistant",
            content: "Response",
            cancelled: false,
            createdAt: new Date().toISOString(),
          });
          return {
            generationId: "gen-2",
            text: "Response",
            status: "complete",
            telemetry: telemetryData,
            errorCode: null,
            streamError: null,
            sessionRebuilt: false,
            replayedTurns: 0,
          };
        },
        async cancel() {
          return { status: "cancelled" };
        },
        async setProfile(conversationId: string, profileId: string) {
          return store.setProfileId(conversationId, profileId);
        },
        async resumeIfInterrupted(): Promise<ResumeResult> {
          return { resumed: false, generationId: null, text: "", status: null, telemetry: null, errorCode: null, streamError: null, reconciledFromSession: false, seqs: [] };
        },
        async listProfiles() {
          return [];
        },
      };

      const controller = mount({
        target,
        coordinator: fakeCoordinator,
        store,
        initialState: { selectedConversationId: conv.id },
      });
      target.attach({ actions: controller.actions, controller });

      const promptInput = root.querySelector('[data-testid="prompt-input"]') as any;
      promptInput.value = "please retry me";
      const sendBtn = root.querySelector('[data-testid="send"]') as any;
      sendBtn.dispatchEvent(new win.Event("click"));

      await new Promise((resolve) => setTimeout(resolve, 0));

      const retryBtn = root.querySelector('[data-testid="retry"]') as any;
      expect(retryBtn).not.toBeNull();

      // Nothing typed in between -- click retry directly.
      retryBtn.dispatchEvent(new win.Event("click"));

      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(sendCalls).toEqual([
        { conversationId: conv.id, prompt: "please retry me" },
        { conversationId: conv.id, prompt: "please retry me" },
      ]);

      const state = controller.getState() as any;
      expect(state.generation.kind).toBe("complete");
      expect(promptInput.value).toBe("");
    });
  });

  // M13-T2: paint must reconcile the transcript <li> list incrementally
  // instead of rebuilding it wholesale on every paint. See
  // .harness/requirements.md's "a very long transcript must not break
  // rendering" edge case (a derived criterion, not a numbered requirement)
  // and M13 acceptance criteria 3 (scaling) and 4 (fidelity).
  describe("M13-T2: incremental transcript rendering", () => {
    function buildBigConversation(id: string, turnCount: number): Conversation {
      const turns: Turn[] = [];
      for (let i = 0; i < turnCount; i++) {
        turns.push({
          role: i % 2 === 0 ? "user" : "assistant",
          // Distinguishable per turn so a reordering, drop, or off-by-one
          // is actually detectable -- not 500 identical entries.
          content: `turn-${i}-of-${turnCount}-unique-payload`,
          cancelled: false,
          createdAt: "2026-01-01T00:00:00Z",
        });
      }
      return {
        id,
        title: "Big transcript",
        sessionId: null,
        profileId: "prof-1",
        turns,
        pending: null,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      };
    }

    // Writes a conversation straight into storage in the app's own
    // envelope shape, so seeding hundreds of turns for a test does not pay
    // the store's O(n^2) appendTurn+persist cost turn by turn.
    function seedStorageWithConversation(storage: ReturnType<typeof createMemoryStorage>, conv: Conversation): void {
      storage.set(
        CONVERSATIONS_STORAGE_KEY,
        JSON.stringify({ version: CONVERSATIONS_SCHEMA_VERSION, conversations: [conv] })
      );
    }

    // A SessionCoordinator that is never actually invoked by these tests --
    // they drive paint() the real way, through the mount handle's own
    // setStreamingText/select/render, not through actions.send.
    function createUnusedCoordinator(): SessionCoordinator {
      return {
        async createConversation(): Promise<Conversation> {
          throw new Error("not used in this test");
        },
        async send(): Promise<SendResult> {
          throw new Error("not used in this test");
        },
        async cancel() {
          return { status: "cancelled" as const };
        },
        async setProfile(): Promise<Conversation> {
          throw new Error("not used in this test");
        },
        async resumeIfInterrupted(): Promise<ResumeResult> {
          throw new Error("not used in this test");
        },
        async listProfiles() {
          return [];
        },
      };
    }

    // Wraps doc.createElement in place (same document object
    // createDomTarget will read as root.ownerDocument) so every element the
    // renderer creates is counted, from the moment the spy is installed.
    function spyOnCreateElement(doc: any): { count(): number; reset(): void } {
      const original = doc.createElement.bind(doc);
      let calls = 0;
      doc.createElement = (...args: any[]) => {
        calls++;
        return original(...args);
      };
      return {
        count: () => calls,
        reset: () => {
          calls = 0;
        },
      };
    }

    function measureCreationsAcrossDeltas(turnCount: number, deltaCount: number): number {
      const { doc, root } = createTestWindow();
      const spy = spyOnCreateElement(doc);
      const target = createDomTarget(root as any);

      const storage = createMemoryStorage();
      const conv = buildBigConversation(`conv-${turnCount}`, turnCount);
      seedStorageWithConversation(storage, conv);
      const store = createConversationStore(storage);

      const handle = mount({
        target,
        coordinator: createUnusedCoordinator(),
        store,
        initialState: { selectedConversationId: conv.id },
      });
      target.attach({ actions: handle.actions, controller: handle });

      // Only count element creation caused by the streaming deltas below,
      // not by the initial mount/paint.
      spy.reset();

      let text = "";
      for (let i = 0; i < deltaCount; i++) {
        text += "x";
        handle.setStreamingText(text);
      }

      return spy.count();
    }

    it("element creation across 200 streaming deltas does not scale with transcript length (M13 acceptance criterion 3)", () => {
      const deltaCount = 200;
      const smallCreations = measureCreationsAcrossDeltas(50, deltaCount);
      const largeCreations = measureCreationsAcrossDeltas(500, deltaCount);

      // A rebuild-every-entry implementation creates roughly
      // deltaCount * turnCount elements for the transcript alone, so the
      // 10x larger transcript would create roughly 10x more elements. The
      // per-delta element count here must not scale with transcript length
      // at all: the two measurements must be nearly identical.
      expect(Math.abs(largeCreations - smallCreations)).toBeLessThan(20);
      // And both must be small in absolute terms -- a handful of elements
      // per delta at most (for unrelated per-paint work such as the
      // conversation list), never hundreds.
      expect(largeCreations).toBeLessThan(deltaCount * 4);
      expect(smallCreations).toBeLessThan(deltaCount * 4);
    });

    it("renders every turn's text intact, in order, matching the view model's own transcript exactly (M13 acceptance criterion 4)", () => {
      const { root } = createTestWindow();
      const target = createDomTarget(root as any);

      const turnCount = 500;
      const storage = createMemoryStorage();
      const conv = buildBigConversation("conv-fidelity", turnCount);
      seedStorageWithConversation(storage, conv);
      const store = createConversationStore(storage);

      const handle = mount({
        target,
        coordinator: createUnusedCoordinator(),
        store,
        initialState: { selectedConversationId: conv.id },
      });
      target.attach({ actions: handle.actions, controller: handle });

      // The view model's own transcript array -- not a separately
      // hand-written expectation and not the renderer's own output.
      const expectedTranscript = buildViewModel(handle.getState()).transcript;
      expect(expectedTranscript.length).toBe(turnCount);

      const renderedTexts = readTranscriptTexts(root);
      expect(renderedTexts.length).toBe(expectedTranscript.length);

      for (let i = 0; i < expectedTranscript.length; i++) {
        const entry = expectedTranscript[i]!;
        const expectedText = `${entry.role}: ${entry.content}${
          entry.cancelled ? " (cancelled)" : ""
        }${entry.pending ? " (pending)" : ""}`;
        expect(renderedTexts[i]).toBe(expectedText);
      }
    });

    it("reuses the same <li> node across paints when a transcript entry is unchanged", () => {
      const { root } = createTestWindow();
      const target = createDomTarget(root as any);
      const storage = createMemoryStorage();
      const store = createConversationStore(storage);
      const conv = store.createConversation({ profileId: "prof-1" });
      store.appendTurn(conv.id, {
        role: "user",
        content: "stable",
        cancelled: false,
        createdAt: "2026-01-01T00:00:00Z",
      });

      const handle = mount({
        target,
        coordinator: createUnusedCoordinator(),
        store,
        initialState: { selectedConversationId: conv.id },
      });
      target.attach({ actions: handle.actions, controller: handle });

      const list = getTranscriptListElement(root);
      const firstNode = list.children[0];

      // Repaint via a streaming delta that only appends a new pending
      // entry after this one -- the existing entry itself does not change.
      handle.setStreamingText("partial reply");

      const secondNode = list.children[0];
      expect(secondNode).toBe(firstNode);
    });

    it("switching the selected conversation replaces the whole transcript, not a mix of both", () => {
      const { root } = createTestWindow();
      const target = createDomTarget(root as any);
      const storage = createMemoryStorage();
      const store = createConversationStore(storage);

      const convA = store.createConversation({ profileId: "prof-1" });
      store.appendTurn(convA.id, {
        role: "user",
        content: "A1",
        cancelled: false,
        createdAt: "2026-01-01T00:00:00Z",
      });
      store.appendTurn(convA.id, {
        role: "assistant",
        content: "A2",
        cancelled: false,
        createdAt: "2026-01-01T00:00:01Z",
      });

      const convB = store.createConversation({ profileId: "prof-1" });
      store.appendTurn(convB.id, {
        role: "user",
        content: "B1",
        cancelled: false,
        createdAt: "2026-01-01T00:00:02Z",
      });

      const handle = mount({
        target,
        coordinator: createUnusedCoordinator(),
        store,
        initialState: { selectedConversationId: convA.id },
      });
      target.attach({ actions: handle.actions, controller: handle });

      expect(readTranscriptTexts(root)).toEqual(["user: A1", "assistant: A2"]);

      handle.select(convB.id);

      expect(readTranscriptTexts(root)).toEqual(["user: B1"]);
    });

    it("a pending entry becoming a real turn after streaming completes leaves the transcript correct, not duplicated", () => {
      const { root } = createTestWindow();
      const target = createDomTarget(root as any);
      const storage = createMemoryStorage();
      const store = createConversationStore(storage);
      const conv = store.createConversation({ profileId: "prof-1" });
      store.appendTurn(conv.id, {
        role: "user",
        content: "hello",
        cancelled: false,
        createdAt: "2026-01-01T00:00:00Z",
      });

      const handle = mount({
        target,
        coordinator: createUnusedCoordinator(),
        store,
        initialState: { selectedConversationId: conv.id },
      });
      target.attach({ actions: handle.actions, controller: handle });

      handle.setStreamingText("Hel");
      handle.setStreamingText("Hello");
      expect(readTranscriptTexts(root)).toEqual(["user: hello", "assistant: Hello (pending)"]);

      // Streaming completes: the app appends the finished turn to the
      // store, clears the streaming projection, then repaints.
      store.appendTurn(conv.id, {
        role: "assistant",
        content: "Hello",
        cancelled: false,
        createdAt: "2026-01-01T00:00:01Z",
      });
      handle.setStreamingText("");
      handle.render();

      expect(readTranscriptTexts(root)).toEqual(["user: hello", "assistant: Hello"]);
    });

    it("a cancelled turn still renders its (cancelled) marker", () => {
      const { root } = createTestWindow();
      const target = createDomTarget(root as any);
      const storage = createMemoryStorage();
      const store = createConversationStore(storage);
      const conv = store.createConversation({ profileId: "prof-1" });
      store.appendTurn(conv.id, {
        role: "user",
        content: "hi",
        cancelled: false,
        createdAt: "2026-01-01T00:00:00Z",
      });
      store.appendTurn(conv.id, {
        role: "assistant",
        content: "Partial",
        cancelled: true,
        createdAt: "2026-01-01T00:00:01Z",
      });

      const handle = mount({
        target,
        coordinator: createUnusedCoordinator(),
        store,
        initialState: { selectedConversationId: conv.id },
      });
      target.attach({ actions: handle.actions, controller: handle });

      expect(readTranscriptTexts(root)).toEqual(["user: hi", "assistant: Partial (cancelled)"]);
    });
  });

  describe("M13-C3 correction: do not clear the prompt input if the human typed into it mid-send", () => {
    it("human-typed text survives a successful send that was in flight", async () => {
      const { win, doc, root } = createTestWindow();
      const target = createDomTarget(root as any);
      const storage = createMemoryStorage();
      const store = createConversationStore(storage);
      const conv = store.createConversation({ profileId: "prof-1" });

      let sendPromise: Promise<any>;
      let resolveSend: () => void;

      const fakeCoordinator: SessionCoordinator = {
        async createConversation(input: { profileId: string; title?: string }) {
          return store.createConversation(input);
        },
        async send(conversationId: string, prompt: string, handlers?: GenerationHandlers): Promise<SendResult> {
          // Create a promise that the test can control
          sendPromise = new Promise((resolve) => {
            resolveSend = () => resolve(undefined);
          });
          await sendPromise;

          store.appendTurn(conversationId, {
            role: "user",
            content: prompt,
            cancelled: false,
            createdAt: new Date().toISOString(),
          });
          store.appendTurn(conversationId, {
            role: "assistant",
            content: "Response",
            cancelled: false,
            createdAt: new Date().toISOString(),
          });

          return {
            generationId: "gen-1",
            text: "Response",
            status: "complete",
            telemetry: null,
            errorCode: null,
            streamError: null,
            sessionRebuilt: false,
            replayedTurns: 0,
          };
        },
        async cancel() {
          return { status: "cancelled" };
        },
        async setProfile(conversationId: string, profileId: string) {
          return store.setProfileId(conversationId, profileId);
        },
        async resumeIfInterrupted(): Promise<ResumeResult> {
          return { resumed: false, generationId: null, text: "", status: null, telemetry: null, errorCode: null, streamError: null, reconciledFromSession: false, seqs: [] };
        },
        async listProfiles() {
          return [{ id: "prof-1", role: "assistant", quality: "high", latency_class: "fast", label: "Profile 1" }];
        },
      };

      const controller = mount({
        target,
        coordinator: fakeCoordinator,
        store,
        initialState: { selectedConversationId: conv.id },
      });

      target.attach({ actions: controller.actions, controller });

      const promptInput = root.querySelector('[data-testid="prompt-input"]') as any;
      promptInput.value = "original prompt";

      const sendBtn = root.querySelector('[data-testid="send"]') as any;
      const sendEventPromise = sendBtn.dispatchEvent(new win.Event("click"));

      // Wait a tick to ensure the send is in flight
      await new Promise(r => setTimeout(r, 0));

      // While send is in flight, human types new text
      promptInput.value = "new text typed while sending";

      // Now let the send complete
      resolveSend!();
      await new Promise(r => setTimeout(r, 10));

      // The newly typed text should survive the send
      expect(promptInput.value).toBe("new text typed while sending");
    });

    it("offline retry path clears the input when retry succeeds without new typing", async () => {
      const { win, doc, root } = createTestWindow();
      const target = createDomTarget(root as any);
      const storage = createMemoryStorage();
      const store = createConversationStore(storage);
      const conv = store.createConversation({ profileId: "prof-1" });

      let rejectFirstSend: any = null;
      let resolveRetry: any = null;
      let sendCount = 0;

      const fakeCoordinator: SessionCoordinator = {
        async createConversation(input: { profileId: string; title?: string }) {
          return store.createConversation(input);
        },
        async send(conversationId: string, prompt: string, handlers?: GenerationHandlers): Promise<SendResult> {
          sendCount++;
          if (sendCount === 1) {
            // First send fails with offline error
            return new Promise<SendResult>((_resolve, reject) => {
              rejectFirstSend = reject;
            });
          } else {
            // Retry succeeds
            return new Promise<SendResult>((resolve) => {
              resolveRetry = resolve;
            });
          }
        },
        async cancel() {
          return { status: "cancelled" };
        },
        async setProfile(conversationId: string, profileId: string) {
          return store.setProfileId(conversationId, profileId);
        },
        async resumeIfInterrupted(): Promise<ResumeResult> {
          return { resumed: false, generationId: null, text: "", status: null, telemetry: null, errorCode: null, streamError: null, reconciledFromSession: false, seqs: [] };
        },
        async listProfiles() {
          return [{ id: "prof-1", role: "assistant", quality: "high", latency_class: "fast", label: "Profile 1" }];
        },
      };

      const controller = mount({
        target,
        coordinator: fakeCoordinator,
        store,
        initialState: { selectedConversationId: conv.id },
      });

      target.attach({ actions: controller.actions, controller });

      const promptInput = root.querySelector('[data-testid="prompt-input"]') as any;
      promptInput.value = "draft prompt";

      const sendBtn = root.querySelector('[data-testid="send"]') as any;
      sendBtn.dispatchEvent(new win.Event("click"));

      // Wait a tick for send to start
      await new Promise(r => setTimeout(r, 0));

      // Reject the send with offline error - this preserves the draft
      if (rejectFirstSend) {
        const err = new HarnessOfflineError("http://example.com", new Error("offline"));
        err.draftPrompt = "draft prompt";
        rejectFirstSend(err);
      }

      await new Promise(r => setTimeout(r, 10));

      // The draft should still be in the input
      expect(promptInput.value).toBe("draft prompt");

      // Now click retry without typing anything new
      const retryBtn = root.querySelector('[data-testid="retry"]') as any;
      expect(retryBtn).not.toBeNull();
      retryBtn.dispatchEvent(new win.Event("click"));

      await new Promise(r => setTimeout(r, 0));

      // Resolve the retry send
      if (resolveRetry) {
        resolveRetry({
          generationId: "gen-1",
          text: "Response",
          status: "complete",
          telemetry: null,
          errorCode: null,
          streamError: null,
          sessionRebuilt: false,
          replayedTurns: 0,
        });
      }

      await new Promise(r => setTimeout(r, 10));

      // Now the input SHOULD be cleared since retry succeeded
      expect(promptInput.value).toBe("");
    });
  });

  describe("reconnecting generation display (M16-T2)", () => {
    it("AC2: generationStatusText renders reconnecting with correct format", () => {
      const { win, doc, root } = createTestWindow();
      const target = createDomTarget(root as any);

      const viewModel = createTestViewModel({
        generation: { kind: "reconnecting", attempt: 3, draftPrompt: null },
      });
      target.paint(viewModel);

      const statusEl = root.querySelector('[data-testid="status"]') as any;
      expect(statusEl?.textContent).toBe("Reconnecting (attempt 3)...");
    });

    it("AC2: reconnecting status text includes attempt number", () => {
      const { win, doc, root } = createTestWindow();
      const target = createDomTarget(root as any);

      const viewModel = createTestViewModel({
        generation: { kind: "reconnecting", attempt: 1, draftPrompt: "test" },
      });
      target.paint(viewModel);

      const statusEl = root.querySelector('[data-testid="status"]') as any;
      expect(statusEl?.textContent).toBe("Reconnecting (attempt 1)...");
    });

    it("AC3: reconnecting is distinguishable from error and offline", () => {
      const { win, doc, root } = createTestWindow();
      const target = createDomTarget(root as any);

      // Test reconnecting
      let viewModel = createTestViewModel({
        generation: { kind: "reconnecting", attempt: 2, draftPrompt: "hi" },
      });
      target.paint(viewModel);
      const reconnectingText = (root.querySelector('[data-testid="status"]') as any)?.textContent ?? "";

      // Test offline
      viewModel = createTestViewModel({
        generation: { kind: "offline", draftPrompt: "hi" },
      });
      target.paint(viewModel);
      const offlineText = (root.querySelector('[data-testid="status"]') as any)?.textContent ?? "";

      // Test error
      viewModel = createTestViewModel({
        generation: { kind: "error", code: "test_error", message: "Test error" },
      });
      target.paint(viewModel);
      const errorText = (root.querySelector('[data-testid="status"]') as any)?.textContent ?? "";

      // AC3: Verify they are all different and reconnecting doesn't have Error or Offline in the text
      expect(reconnectingText).not.toBe(offlineText);
      expect(reconnectingText).not.toBe(errorText);
      expect(reconnectingText).not.toContain("Error");
      expect(reconnectingText).not.toContain("Offline");
      expect(reconnectingText).toContain("Reconnecting");
    });

    it("AC4: reconnecting preserves draftPrompt through buildViewModel", () => {
      // This test verifies that the draftPrompt is preserved
      // Testing through the view model layer
      const state: UiState = {
        conversations: [],
        selectedConversationId: null,
        profiles: [],
        generation: {
          kind: "reconnecting",
          attempt: 2,
          draftPrompt: "my prompt",
        },
        streamingText: "",
        notice: null,
      };

      const model = buildViewModel(state);

      expect(model.generation.kind).toBe("reconnecting");
      if (model.generation.kind !== "reconnecting") {
        throw new Error("Expected reconnecting");
      }
      expect(model.generation.draftPrompt).toBe("my prompt");
    });
  });
});
