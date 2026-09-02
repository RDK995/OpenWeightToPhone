// The thin, DOM-free mounting layer that turns the pure view-model
// (view-model.ts) and action map (actions.ts) into a running client. This
// module must never touch the DOM, browser storage, or the network directly,
// and must never runtime-import ./dom-target -- see test/web/ui/mount.test.ts's
// "no bypass access" suite, which asserts this over the file's text.
import type { SessionCoordinator } from "../session-coordinator";
import type { ConversationStore } from "../conversation-store";
import type { Profile } from "../api-client";
import type { RenderTarget } from "./render-target";
import type { UiActions } from "./actions";
import type { UiState, GenerationDisplay } from "./view-model";
import { createActions } from "./actions";
import { buildViewModel } from "./view-model";

export interface MountDeps {
  target: RenderTarget;
  coordinator: SessionCoordinator;
  store: ConversationStore;
  initialState?: {
    selectedConversationId?: string | null;
    profiles?: readonly Profile[];
    generation?: GenerationDisplay;
    streamingText?: string;
    notice?: string | null;
  };
}

export interface MountHandle {
  getState(): UiState;
  render(): void;
  select(conversationId: string | null): void;
  setGeneration(generation: GenerationDisplay): void;
  setStreamingText(text: string): void;
  setProfiles(profiles: readonly Profile[]): void;
  setNotice(notice: string | null): void;
  actions: UiActions;
}

function copyState(state: UiState): UiState {
  return {
    conversations: state.conversations,
    selectedConversationId: state.selectedConversationId,
    profiles: state.profiles,
    generation: state.generation,
    streamingText: state.streamingText,
    notice: state.notice,
  };
}

export function mount(deps: MountDeps): MountHandle {
  const { target, coordinator, store, initialState } = deps;

  let state: UiState = {
    conversations: store.loadConversations(),
    selectedConversationId: initialState?.selectedConversationId ?? null,
    profiles: initialState?.profiles ?? [],
    generation: initialState?.generation ?? { kind: "idle" },
    streamingText: initialState?.streamingText ?? "",
    notice: initialState?.notice ?? null,
  };

  function paint(): void {
    target.paint(buildViewModel(state));
  }

  // Paint exactly once during mount().
  paint();

  return {
    getState(): UiState {
      return copyState(state);
    },

    render(): void {
      state = { ...state, conversations: store.loadConversations() };
      paint();
    },

    select(conversationId: string | null): void {
      state = { ...state, selectedConversationId: conversationId };
      paint();
    },

    setGeneration(generation: GenerationDisplay): void {
      state = { ...state, generation };
      paint();
    },

    setStreamingText(text: string): void {
      state = { ...state, streamingText: text };
      paint();
    },

    setProfiles(profiles: readonly Profile[]): void {
      state = { ...state, profiles };
      paint();
    },

    setNotice(notice: string | null): void {
      state = { ...state, notice };
      paint();
    },

    actions: createActions(coordinator, store),
  };
}
