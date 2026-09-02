// One of the two modules in web/src/ permitted to touch the DOM -- the
// other is ui/pairing-target.ts. That module is kept separate because it
// renders before any conversation UI exists: the app has no credential yet,
// and every API call this module could make would 401. Its rendering is
// attested on the physical device in milestone M10, not here -- kept as
// small and obvious as possible: plain DOM calls, no framework, no
// innerHTML with interpolated content.
import type { RenderTarget } from "./render-target";
import type { ViewModel, GenerationDisplay } from "./view-model";
import type { UiActions } from "./actions";
import type { Profile } from "../api-client";
import type { GenerationHandlers } from "../session-coordinator";
import type { HarnessStreamError } from "../api-client";
import { HarnessOfflineError } from "../api-client";
import { toTelemetryDisplay, describeError } from "./view-model";
// HarnessOfflineError is imported as a value (not `import type`) above
// because the send handler needs it for an `instanceof` check at runtime.

export interface DomController {
  render(): void;
  select(conversationId: string | null): void;
  setGeneration(generation: GenerationDisplay): void;
  setStreamingText(text: string): void;
  setProfiles(profiles: readonly Profile[]): void;
  setNotice(notice: string | null): void;
}

export interface DomTarget extends RenderTarget {
  attach(deps: { actions: UiActions; controller: DomController }): void;
}

function generationStatusText(generation: GenerationDisplay): string {
  switch (generation.kind) {
    case "idle":
      return "Idle";
    case "queued":
      return `Queued (position ${generation.position})`;
    case "model-loading":
      return "Loading model...";
    case "streaming":
      return "Streaming...";
    case "complete":
      return (
        `Complete — ${generation.telemetry.tokensPerSecond} tok/s, ` +
        `${generation.telemetry.evalCount} tokens evaluated, ` +
        `quantization ${generation.telemetry.quantization}, ` +
        `context limit ${generation.telemetry.contextLimit}`
      );
    case "cancelled":
      return "Cancelled";
    case "error":
      return `Error (${generation.code}): ${generation.message}`;
    case "offline":
      return "Offline";
    case "reconnecting":
      return `Reconnecting (attempt ${generation.attempt})...`;
  }
}

// The offline element's copy is deliberately hand-written here rather than
// produced by describeError(): it must never surface a harness error code
// (see GenerationDisplay's "offline" variant, which carries none) since a
// transport failure is not a documented harness error response at all.
const OFFLINE_MESSAGE =
  "Your Mac could not be reached. Your prompt has been kept — use Retry to send it again once the harness is reachable.";

export function createDomTarget(root: HTMLElement): DomTarget {
  const doc = root.ownerDocument;

  let deps: { actions: UiActions; controller: DomController } | null = null;
  let selectedConversationId: string | null = null;
  let profiles: readonly Profile[] = [];
  // Tracks the last generation state painted, so the retry control (created
  // once, outside paint()) can read the preserved draft at click time.
  let currentGeneration: GenerationDisplay = { kind: "idle" };
  // Transcript <li> nodes currently mounted in transcriptList, one per
  // view.transcript index, persisted across paint() calls so paint can
  // reconcile incrementally instead of rebuilding the whole list every time
  // (M13-T2). Index i here always corresponds to view.transcript[i] as of
  // the most recent paint.
  let transcriptNodes: HTMLLIElement[] = [];

  // Create sections for layout
  const controlsSection = doc.createElement("section");
  const conversationsList = doc.createElement("ul");
  const conversationsSection = doc.createElement("section");
  conversationsSection.appendChild(conversationsList);

  const transcriptList = doc.createElement("ul");
  const transcriptSection = doc.createElement("section");
  transcriptSection.appendChild(transcriptList);

  const profilesList = doc.createElement("ul");
  const profilesSection = doc.createElement("section");
  profilesSection.appendChild(profilesList);

  const statusSection = doc.createElement("section");
  statusSection.setAttribute("data-testid", "status");

  // Surfaces failures and guard-clause refusals (BLOCKER 2 correction,
  // M12-C1T2). Appended LAST -- several tests select sections/uls
  // positionally, and adding a section at the end with no <ul> inside it
  // leaves every existing index valid. Do not reorder or insert elsewhere.
  const noticeSection = doc.createElement("section");
  noticeSection.setAttribute("data-testid", "notice");

  // Distinct offline surface (M13-T1): rendered only when generation.kind
  // is "offline" -- a transport failure (the harness/tailnet is
  // unreachable), never a documented harness error code. Kept separate
  // from noticeSection/statusSection so it cannot be confused with, or
  // collapse into, the generic error surface. Appended even later than
  // noticeSection for the same positional-index reason given above.
  const offlineSection = doc.createElement("section");
  offlineSection.setAttribute("data-testid", "offline");
  const offlineMessage = doc.createElement("p");
  offlineSection.appendChild(offlineMessage);

  const retryBtn = doc.createElement("button");
  retryBtn.setAttribute("data-testid", "retry");
  retryBtn.textContent = "Retry";

  root.replaceChildren(
    controlsSection,
    conversationsSection,
    transcriptSection,
    profilesSection,
    statusSection,
    noticeSection,
    offlineSection
  );

  // Create and add controls to controlsSection
  const promptInput = doc.createElement("textarea");
  promptInput.setAttribute("data-testid", "prompt-input");

  // Shared by the send button and the offline-state retry control, so a
  // retry re-sends the exact preserved draft through the exact same path a
  // fresh send would take. Takes the conversation id and the already-
  // trimmed prompt explicitly rather than reading promptInput.value, so a
  // retry is not affected by whatever the human may have typed since the
  // failure.
  function doSend(conversationId: string, prompt: string): void {
    if (!deps) return;
    const d = deps;
    d.controller.setNotice(null);

    // Capture the input's current value so we can guard against clearing text
    // the human may have typed while the send was in flight (M13-C3).
    const inputSnapshot = promptInput.value;

    // Create handlers for streaming updates
    let streamed = "";
    let announcedStreaming = false;

    const handlers: GenerationHandlers = {
      onQueued: (position) => {
        d.controller.setGeneration({ kind: "queued", position });
      },
      onModelLoading: () => {
        d.controller.setGeneration({ kind: "model-loading" });
      },
      onDelta: (delta) => {
        streamed += delta;
        if (!announcedStreaming) {
          announcedStreaming = true;
          d.controller.setGeneration({ kind: "streaming" });
        }
        d.controller.setStreamingText(streamed);
      },
      onComplete: (telemetry) => {
        d.controller.setGeneration({
          kind: "complete",
          telemetry: toTelemetryDisplay(telemetry),
        });
      },
      onCancelled: () => {
        d.controller.setGeneration({ kind: "cancelled" });
      },
      onError: (code, error: HarnessStreamError) => {
        d.controller.setStreamingText("");
        d.controller.setGeneration({
          kind: "error",
          code,
          message: error.guidance.detail,
        });
      },
    };

    d.controller.setStreamingText("");
    d.controller.setGeneration({ kind: "streaming" });

    d.actions.send(conversationId, prompt, handlers)
      .then(() => {
        d.controller.setStreamingText("");
        // Only clear the draft once a send has actually succeeded -- a
        // send that fails at the transport layer must leave the drafted
        // prompt exactly as the human typed it (M13-T1). Also guard against
        // clearing text if the human typed new input while the send was in
        // flight (M13-C3).
        if (promptInput.value === inputSnapshot) {
          promptInput.value = "";
        }
        d.controller.render();
      })
      .catch((error) => {
        d.controller.setStreamingText("");
        if (error instanceof HarnessOfflineError) {
          // A transport failure, not a documented harness error code: a
          // peer "offline" generation state, not the generic notice/error
          // surface (M13-T1).
          d.controller.setGeneration({
            kind: "offline",
            draftPrompt: error.draftPrompt ?? prompt,
          });
          return;
        }
        d.controller.setNotice(describeError(error));
      });
  }

  const sendBtn = doc.createElement("button");
  sendBtn.setAttribute("data-testid", "send");
  sendBtn.textContent = "Send";
  sendBtn.addEventListener("click", () => {
    if (!deps) return;
    if (!selectedConversationId) {
      deps.controller.setNotice("Select a conversation before sending.");
      return;
    }

    const trimmedText = promptInput.value.trim();
    if (trimmedText === "") {
      deps.controller.setNotice("Type a prompt before sending.");
      return;
    }

    doSend(selectedConversationId, trimmedText);
  });

  retryBtn.addEventListener("click", () => {
    if (!deps) return;
    if (!selectedConversationId) return;
    if (currentGeneration.kind !== "offline") return;
    const draft = currentGeneration.draftPrompt;
    if (draft === null || draft.trim() === "") return;
    doSend(selectedConversationId, draft);
  });

  const cancelBtn = doc.createElement("button");
  cancelBtn.setAttribute("data-testid", "cancel");
  cancelBtn.textContent = "Cancel";
  cancelBtn.addEventListener("click", () => {
    if (!deps) return;
    if (!selectedConversationId) {
      deps.controller.setNotice("Select a conversation before cancelling.");
      return;
    }
    const d = deps;
    d.controller.setNotice(null);
    d.actions.cancel(selectedConversationId)
      .catch((error) => {
        d.controller.setNotice(describeError(error));
      });
  });

  const profileSelect = doc.createElement("select");
  profileSelect.setAttribute("data-testid", "profile-select");

  profileSelect.addEventListener("change", () => {
    if (!deps) return;
    if (!selectedConversationId) {
      deps.controller.setNotice("Select a conversation before changing its profile.");
      return;
    }
    const selectedProfileId = profileSelect.value;
    if (selectedProfileId) {
      const d = deps;
      d.controller.setNotice(null);
      d.actions.chooseProfile(selectedConversationId, selectedProfileId)
        .then(() => {
          d.controller.render();
        })
        .catch((error) => {
          d.controller.setNotice(describeError(error));
        });
    }
  });

  const createConversationBtn = doc.createElement("button");
  createConversationBtn.setAttribute("data-testid", "create-conversation");
  createConversationBtn.textContent = "Create";
  createConversationBtn.addEventListener("click", () => {
    if (!deps) return;
    const selectedProfileId = profileSelect.value;
    if (!selectedProfileId) {
      // This is the unpaired case (BLOCKER 2, M12-C1T2): an unpaired or
      // no-longer-authorised phone never receives a profile list, so the
      // selector stays empty and this guard fires. Point at pairing, not
      // just "pick a profile".
      deps.controller.setNotice(
        "No profile selected, and none are available to choose from. If this " +
          "device is not paired with your Mac's harness, or the pairing is no " +
          "longer valid, scan the pairing QR code again to re-pair."
      );
      return;
    }

    // Capture deps once to avoid null narrowing issues in the handler below.
    const d = deps;
    d.controller.setNotice(null);

    d.actions.createConversation({ profileId: selectedProfileId })
      .then((conversation) => {
        d.controller.render(); // reloads conversations from the store
        d.controller.select(conversation.id); // selects the new one and repaints
      })
      .catch((error) => {
        d.controller.setNotice(describeError(error));
      });
  });

  controlsSection.appendChild(promptInput);
  controlsSection.appendChild(sendBtn);
  controlsSection.appendChild(cancelBtn);
  controlsSection.appendChild(profileSelect);
  controlsSection.appendChild(createConversationBtn);

  return {
    attach(newDeps: { actions: UiActions; controller: DomController }): void {
      deps = newDeps;
    },

    paint(view: ViewModel): void {
      selectedConversationId = view.conversations.find((c) => c.selected)?.id ?? null;
      profiles = view.profiles;
      currentGeneration = view.generation;

      // Update profile selector
      const selectedProfileId = view.selectedProfileId;
      const profileOptions = view.profiles.map((profile) => {
        const option = doc.createElement("option");
        option.value = profile.id;
        option.textContent = profile.label;
        if (profile.id === selectedProfileId) {
          option.selected = true;
        }
        return option;
      });
      profileSelect.replaceChildren(...profileOptions);

      // Render conversations
      const conversationItems = view.conversations.map((conversation) => {
        const item = doc.createElement("li");

        const openBtn = doc.createElement("button");
        openBtn.setAttribute("data-testid", "open-conversation");
        openBtn.setAttribute("data-conversation-id", conversation.id);
        openBtn.textContent = `${conversation.selected ? "▸ " : ""}${
          conversation.title || conversation.id
        } (${conversation.updatedAt})`;
        openBtn.addEventListener("click", () => {
          if (!deps) return;
          deps.controller.select(conversation.id);
        });

        const deleteBtn = doc.createElement("button");
        deleteBtn.setAttribute("data-testid", "delete-conversation");
        deleteBtn.setAttribute("data-conversation-id", conversation.id);
        deleteBtn.textContent = "Delete";
        deleteBtn.addEventListener("click", () => {
          if (!deps) return;
          const d = deps;
          d.actions.deleteConversation(conversation.id);
          if (selectedConversationId === conversation.id) {
            d.controller.select(null);
          }
          d.controller.render();
        });

        item.appendChild(openBtn);
        item.appendChild(deleteBtn);
        return item;
      });
      conversationsList.replaceChildren(...conversationItems);

      // Render transcript incrementally (M13-T2): reuse the existing <li>
      // at each index when that entry's rendered text is unchanged, so DOM
      // work per paint tracks what actually changed -- typically just the
      // one growing pending entry during streaming -- rather than the
      // whole transcript length. This stays correct (not just fast) across
      // every shape the transcript can take: a stable prefix plus a
      // mutating tail during streaming, a switched conversation (an
      // entirely different transcript at the same indices), an appended
      // turn, and a pending entry flipping to a finished or cancelled one
      // -- because each index is compared by its actual rendered text, not
      // assumed unchanged.
      for (let i = 0; i < view.transcript.length; i++) {
        const entry = view.transcript[i]!;
        const text = `${entry.role}: ${entry.content}${
          entry.cancelled ? " (cancelled)" : ""
        }${entry.pending ? " (pending)" : ""}`;
        let item = transcriptNodes[i];
        if (!item) {
          item = doc.createElement("li");
          transcriptNodes[i] = item;
          transcriptList.appendChild(item);
        }
        if (item.textContent !== text) {
          item.textContent = text;
        }
      }
      // Drop any nodes left over from a longer previous transcript (e.g.
      // switching to a conversation with fewer turns).
      if (transcriptNodes.length > view.transcript.length) {
        for (let i = view.transcript.length; i < transcriptNodes.length; i++) {
          transcriptNodes[i]!.remove();
        }
        transcriptNodes.length = view.transcript.length;
      }

      // Render profiles list
      const profileItems = view.profiles.map((profile) => {
        const item = doc.createElement("li");
        item.textContent = `${profile.label}${
          profile.id === view.selectedProfileId ? " (selected)" : ""
        }`;
        return item;
      });
      profilesList.replaceChildren(...profileItems);

      statusSection.textContent = generationStatusText(view.generation);
      noticeSection.textContent = view.notice ?? "";

      // Offline surface (M13-T1): the retry control is present only while
      // the state is actually offline, so its presence in the DOM is
      // itself the signal a retry is possible.
      if (view.generation.kind === "offline") {
        offlineMessage.textContent = OFFLINE_MESSAGE;
        if (!offlineSection.contains(retryBtn)) {
          offlineSection.appendChild(retryBtn);
        }
      } else {
        offlineMessage.textContent = "";
        if (offlineSection.contains(retryBtn)) {
          retryBtn.remove();
        }
      }
    },
  };
}
