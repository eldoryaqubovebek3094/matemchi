const UI = (() => {
  function clear(el) {
    el.innerHTML = "";
  }

  // Visual aids
  function renderVisualAid(el, q) {
    clear(el);
    if (q.visual === "none") return;

    if (q.visual === "dots" && q.op === "+") {
      // Show a + b as colored dots
      const makeDot = (cls) => {
        const d = document.createElement("div");
        d.className = `dot ${cls}`;
        return d;
      };
      for (let i = 0; i < q.a; i++) el.appendChild(makeDot("dot--red"));
      for (let i = 0; i < q.b; i++) el.appendChild(makeDot("dot--yellow"));
    } else if (q.visual === "dots" && q.op === "-") {
      // Show a as white, b as red (to subtract)
      const makeDot = (cls) => {
        const d = document.createElement("div");
        d.className = `dot ${cls}`;
        return d;
      };
      for (let i = 0; i < q.a; i++) el.appendChild(makeDot("dot--white"));
      for (let i = 0; i < q.b; i++) el.appendChild(makeDot("dot--red"));
    } else if (q.visual === "array" && q.op === "×") {
      // Show a × b as grid of dots
      const grid = document.createElement("div");
      grid.className = "dotgrid";
      grid.style.setProperty("--cols", q.b);
      for (let i = 0; i < q.a * q.b; i++) {
        const d = document.createElement("div");
        d.className = "dot dot--yellow";
        grid.appendChild(d);
      }
      el.appendChild(grid);
    } else if (q.visual === "array" && q.op === "÷") {
      // Show division as groups
      const grid = document.createElement("div");
      grid.className = "dotgrid";
      grid.style.setProperty("--cols", Math.min(q.b, 10));
      for (let i = 0; i < q.a; i++) {
        const d = document.createElement("div");
        d.className = "dot dot--red";
        grid.appendChild(d);
      }
      el.appendChild(grid);
    }
  }

  // Answers
  function renderAnswers(el, q, style, onSubmit) {
    clear(el);
    if (style === "choices") {
      q.choices.forEach((val) => {
        const btn = document.createElement("button");
        btn.className = "answer-btn";
        btn.textContent = val;
        btn.addEventListener("click", () => onSubmit(val));
        el.appendChild(btn);
      });
      setRandomColors();
    } else {
      // keypad input
      const display = document.createElement("div");
      display.className = "input-display";
      display.textContent = "";
      el.appendChild(display);

      const keypad = document.createElement("div");
      keypad.className = "keypad";
      const keys = [
        "1",
        "2",
        "3",
        "4",
        "5",
        "6",
        "7",
        "8",
        "9",
        "del",
        "0",
        "ok",
      ];
      keys.forEach((k) => {
        const b = document.createElement("button");
        b.className = "key" + (k === "del" ? " key--del" : "") + (k === "ok" ? " key--ok" : "");
        b.textContent = k === "del" ? "⌫" : k === "ok" ? "OK" : k;
        b.addEventListener("click", () => {
          if (k === "del") {
            display.textContent = display.textContent.slice(0, -1);
          } else if (k === "ok") {
            const val = Number(display.textContent || "0");
            onSubmit(val);
          } else {
            display.textContent += k;
          }
        });
        keypad.appendChild(b);
      });
      el.appendChild(keypad);
    }
  }

  // Feedback
  function flashAnswer(ok) {
    const body = document.body;
    body.classList.add(ok ? "flash-ok" : "flash-bad");
    setTimeout(() => body.classList.remove("flash-ok", "flash-bad"), 400);
  }

  // Toast
  let toastEl;
  function toast(msg) {
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.className = "toast";
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.classList.add("toast--show");
    setTimeout(() => toastEl.classList.remove("toast--show"), 1200);
  }

  // Results rendering
  function renderSummary(report) {
    return `
      <div class="summary">
        <div class="summary__box"><strong>Rejim:</strong> ${report.mode}</div>
        <div class="summary__box"><strong>Ball:</strong> ${
          report.totalScore
        }</div>
        <div class="summary__box"><strong>Daraja:</strong> ${
          report.levelReached
        }</div>
        <div class="summary__box"><strong>To‘g‘ri:</strong> ${report.correct}/${
      report.asked
    }</div>
        <div class="summary__box"><strong>Aniqlik:</strong> ${Math.round(
          report.accuracy * 100
        )}%</div>
      </div>
    `;
  }

  function renderResultList(report) {
    return report.items
      .map(
        (item) => `
      <div class="result-item ${
        item.ok ? "result-item--ok" : "result-item--bad"
      }">
        <div class="result-item__eq">${item.eq}</div>
        <div class="result-item__ans">
          ${item.user === null ? "<em>O‘tkazildi</em>" : `Siz: ${item.user}`}
          ${
            !item.ok
              ? ` → <span class="result-item__correct">${item.correct}</span>`
              : ""
          }
        </div>
      </div>
    `
      )
      .join("");
  }

  return {
    renderVisualAid,
    renderAnswers,
    flashAnswer,
    toast,
    renderSummary,
    renderResultList,
  };
})();

if (typeof window !== "undefined") window.UI = UI;

// Ranglar ro'yxati
const colors = [
  { bg: "#ffc933", fg: "#14122b" },
  { bg: "#2dd4a7", fg: "#14122b" },
  { bg: "#4cc3ff", fg: "#14122b" },
  { bg: "#ff5d73", fg: "#ffffff" },
  { bg: "#9b6dff", fg: "#ffffff" },
];

function setRandomColors() {
  // Ranglar aralashtiriladi, shunda yonma-yon tugmalar bir xil bo'lmaydi
  const pool = [...colors].sort(() => Math.random() - 0.5);
  document.querySelectorAll(".answer-btn").forEach((btn, i) => {
    const c = pool[i % pool.length];
    btn.style.backgroundColor = c.bg;
    btn.style.color = c.fg;
  });
}

// Har safar sahifa yangilanganda ranglar o'zgaradi
window.onload = setRandomColors;

// Agar har safar bosilganda ham rang o'zgarsin desang:
document.querySelectorAll(".answer-btn").forEach((btn) => {
  btn.addEventListener("click", setRandomColors);
});
