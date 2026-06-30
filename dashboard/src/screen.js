function setScreen(screen) {
  const main = document.querySelector("#main-canvas");
  if (!main) return;
  main.dataset.screen = screen;
  document.body.dataset.screen = screen;
}

function inferScreenFromLayer(layer) {
  if (layer === "linked" || layer === "ascend") {
    setScreen("result");
    return;
  }
  if (["descend", "l4l3", "mid", "l2", "low"].includes(layer)) {
    setScreen("sea");
  }
}

window.addEventListener("DOMContentLoaded", () => {
  const main = document.querySelector("#main-canvas");
  const simulateButton = document.querySelector("#simulate-button");
  const physicalPrompt = document.querySelector("#physical-prompt");

  setScreen("intro");

  simulateButton?.addEventListener(
    "click",
    () => {
      setScreen("sea");
    },
    { capture: true },
  );

  physicalPrompt?.addEventListener("click", () => {
    setScreen("sea");
  });

  if (main) {
    const observer = new MutationObserver(() => {
      inferScreenFromLayer(main.dataset.layer);
    });
    observer.observe(main, { attributes: true, attributeFilter: ["data-layer"] });
  }
});
