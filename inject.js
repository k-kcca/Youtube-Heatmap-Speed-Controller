// inject.js

(function () {
  // 可変パラメータ（スライダーで変更可能） 
  let minRate = 1.00;  // 1.0〜3.0まで可変
  let maxRate = 3.00;  // 2.0〜5.0まで可変

  const updateInterval = 0.5;
  const checkInterval = 1000;

  // アルゴリズム用パラメータ
  let sigmoidK = 25;
  let sigmoidCenter = 0.5;
  let expPower = 1.0;
  let quantileBins = 5;
  // let logOffset = 0.0;

  // 状態
  let currentPanel = null;
  let currentWaveform = null;
  let ratesByAlgo = null;
  let currentAlgo = "指数";
  let manualMode = false;
  let manualRate = 1.0;
  let currentVideoId = null;

  // アルゴリズム定義 
  const algorithms = {
    // "線形": (wave) => wave.map(y => minRate + (maxRate - minRate) * (1 - y)),

    "指数": (wave) =>
      wave.map(y => minRate + (maxRate - minRate) * ((1 - y) ** expPower)),

    "シグモイド": (wave) =>
      wave.map(y =>
        minRate +
        (maxRate - minRate) *
        (1 - 1 / (1 + Math.exp(-sigmoidK * (y - sigmoidCenter))))
      ),

    "分位数": (wave) => {
      const sorted = [...wave].sort((a, b) => a - b);
      const bins = Math.max(2, Math.floor(quantileBins));
      const quantiles = Array.from({ length: bins + 1 }, (_, i) => {
        const idx = Math.floor((i / bins) * (sorted.length - 1));
        return sorted[idx];
      });
      const speeds = Array.from({ length: bins }, (_, i) =>
        maxRate - ((maxRate - minRate) * (i / (bins -1)))
      );
      return wave.map(y => {
        for (let i = 0; i < bins; i++)
          if (y <= quantiles[i + 1]) return speeds[i];
        return minRate;
      });
    },

    "平均比較": (wave) => {
      const μ = wave.reduce((a, b) => a + b, 0) / wave.length;
      return wave.map(y => y > μ
        ? minRate
        : minRate + (1 - y / μ) * (maxRate - minRate)
      );
    },

    /* "対数": (wave) =>
      wave.map(y => {
        const safeY = Math.max(y, 0.000001);
        const v = Math.log2(1 + logOffset + safeY);
        const base = Math.log2(1 + logOffset + 1);
        return minRate + (maxRate - minRate) * (1 - v / base);
      }) */
  };

  //   
  const getVideo = () => document.querySelector("video");

  function applyPlaybackRate(video, rate) {
    if (!video) return;
    let r = Math.max(minRate, Math.min(maxRate, rate));
    if (!isFinite(r)) return;

    video.playbackRate = r;
    video.dispatchEvent(new Event("ratechange", { bubbles: true }));
  }

  function extractWaveform(pathElem) {
    if (!pathElem) return null;

    const d = pathElem.getAttribute("d") || "";
    const coords = [...d.matchAll(/([\d.]+),([\d.]+)/g)].map(m => parseFloat(m[2]));
    if (!coords.length) return null;

    const maxY = Math.max(...coords);
    if (!maxY) return null;

    return coords.map(y => 1 - y / maxY);
  }

  function getHeatmapWaveformOnce() {
    return extractWaveform(document.querySelector("path.ytp-modern-heat-map"));
  }

  function recomputeRates() {
    if (!currentWaveform) { ratesByAlgo = null; return; }
    ratesByAlgo = {};
    for (const [name, func] of Object.entries(algorithms)) {
      try { ratesByAlgo[name] = func(currentWaveform); }
      catch { ratesByAlgo[name] = null; }
    }
  }

  // パネル生成
  function createPanel(video) {
    if (currentPanel) currentPanel.remove();

    const panel = document.createElement("div");
    Object.assign(panel.style, {
      position: "fixed",
      top: "110px",
      right: "20px",
      width: "360px",
      padding: "12px",
      background: "rgba(0,0,0,0.8)",
      color: "#fff",
      borderRadius: "8px",
      fontSize: "13px",
      userSelect: "none",
      zIndex: 999999,
      backdropFilter: "blur(6px)",
      boxShadow: "0 4px 12px rgba(0,0,0,0.5)"
    });

    // ボタン群
    const btnBox = document.createElement("div");
    btnBox.style.position = "absolute";
    btnBox.style.top = "6px";
    btnBox.style.right = "8px";
    btnBox.style.display = "flex";
    btnBox.style.gap = "6px";

    const minBtn = document.createElement("button");
    minBtn.textContent = "−";
    minBtn.style.cursor = "pointer";

    const closeBtn = document.createElement("button");
    closeBtn.textContent = "×";
    closeBtn.style.cursor = "pointer";

    btnBox.appendChild(minBtn);
    btnBox.appendChild(closeBtn);
    panel.appendChild(btnBox);

    const content = document.createElement("div");
    content.style.marginTop = "26px";
    panel.appendChild(content);

    const title = document.createElement("div");
    title.textContent = "ヒートマップ速度コントローラ";
    title.style.fontWeight = "700";
    title.style.marginBottom = "6px";
    title.style.cursor = "move";
    content.appendChild(title);

    closeBtn.addEventListener("click", () => {
      panel.remove();
      currentPanel = null;
    });

    // 最小化機能
    let minimized = false;
    minBtn.addEventListener("click", () => {
      minimized = !minimized;
      content.style.display = minimized ? "none" : "block";
      minBtn.textContent = minimized ? "+" : "−";
    });

    // ドラッグ移動機能
    let dragging = false, dx = 0, dy = 0;

    function isDragExcluded(target) {
      const tag = target.tagName.toLowerCase();
      return tag === "button" || tag === "select" || tag === "input";
    }

    panel.addEventListener("mousedown", (e) => {
      if (isDragExcluded(e.target)) return;
      dragging = true;
      dx = e.clientX - panel.offsetLeft;
      dy = e.clientY - panel.offsetTop;
      e.preventDefault();
    });

    document.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      panel.style.left = (e.clientX - dx) + "px";
      panel.style.top = (e.clientY - dy) + "px";
      panel.style.right = "auto";
    });

    document.addEventListener("mouseup", () => dragging = false);

    // アルゴリズム選択と自動/手動切替
    const row = document.createElement("div");
    row.style.display = "flex";
    row.style.gap = "8px";
    content.appendChild(row);

    const algoSelect = document.createElement("select");
    Object.assign(algoSelect.style, { flex: "1" });

    for (const n of Object.keys(algorithms)) {
      const op = document.createElement("option"); op.value = n; op.textContent = n;
      algoSelect.appendChild(op);
    }
    algoSelect.value = currentAlgo;
    algoSelect.addEventListener("change", () => currentAlgo = algoSelect.value);
    row.appendChild(algoSelect);

    const autoBtn = document.createElement("button");
    const manualBtn = document.createElement("button");
    autoBtn.textContent = "自動";
    manualBtn.textContent = "手動";
    autoBtn.style.cursor = manualBtn.style.cursor = "pointer";

    row.appendChild(autoBtn);
    row.appendChild(manualBtn);

    function updateModeUI() {
      autoBtn.style.background = manualMode ? "" : "#66c2ff";
      manualBtn.style.background = manualMode ? "#ff9966" : "";
    }
    updateModeUI();

    autoBtn.addEventListener("click", () => {
      manualMode = false;
      updateModeUI();
    });

    manualBtn.addEventListener("click", () => {
      manualMode = true;
      updateModeUI();
      applyPlaybackRate(video, manualRate);
    });

    const speedDisplay = document.createElement("div");
    speedDisplay.style.marginTop = "6px";
    speedDisplay.textContent = "速度: 1.00x";
    content.appendChild(speedDisplay);

    // 波形キャンバス
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 60;
    canvas.style.background = "rgba(255,255,255,0.06)";
    canvas.style.borderRadius = "6px";
    canvas.style.marginTop = "6px";
    content.appendChild(canvas);

    const ctx = canvas.getContext("2d");

    function drawWaveform(progress = 0) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      if (!currentWaveform) {
        ctx.fillStyle = "#fff";
        ctx.font = "12px sans-serif";
        ctx.fillText("ヒートマップ情報がありません", 10, 34);
        return;
      }

      ctx.strokeStyle = "#00ff76";
      ctx.lineWidth = 2;
      ctx.beginPath();
      const L = currentWaveform.length;
      for (let i = 0; i < L; i++) {
        const x = (i / (L - 1)) * canvas.width;
        const y = canvas.height * (1 - currentWaveform[i]);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();

      const cx = progress * canvas.width;
      ctx.strokeStyle = "#ff5757";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(cx, 0);
      ctx.lineTo(cx, canvas.height);
      ctx.stroke();
    }

    // 手動速度スライダー
    const manualBox = document.createElement("div");
    manualBox.style.marginTop = "8px";
    content.appendChild(manualBox);

    manualBox.innerHTML = `
      <div id="manualLabel" style="font-size:12px; margin-bottom:3px;">手動速度: ${manualRate.toFixed(2)}x</div>
      <input id="manualSlider" type="range" min="1.00" max="5.00" step="0.05" value="${manualRate}" style="width:100%">
    `;
    const manualLabel = manualBox.querySelector("#manualLabel");
    const manualSlider = manualBox.querySelector("#manualSlider");

    manualSlider.addEventListener("input", () => {
      manualRate = Number(manualSlider.value);
      manualLabel.textContent = `手動速度: ${manualRate.toFixed(2)}x`;

      if (manualMode) {
        applyPlaybackRate(video, manualRate);
        speedDisplay.textContent = `速度: ${manualRate.toFixed(2)}x（手動）`;
      }
    });

    // パラメータスライダー
    const paramBox = document.createElement("div");
    paramBox.style.marginTop = "10px";
    content.appendChild(paramBox);

    function addSlider(name, initial, min, max, step, callback) {
      const wrap = document.createElement("div");
      wrap.style.marginBottom = "6px";

      const label = document.createElement("div");
      label.textContent = `${name}: ${initial}`;
      label.style.fontSize = "12px";
      wrap.appendChild(label);

      const slider = document.createElement("input");
      slider.type = "range";
      slider.min = min;
      slider.max = max;
      slider.step = step;
      slider.value = initial;
      slider.style.width = "100%";

      slider.addEventListener("input", () => {
        const v = Number(slider.value);
        label.textContent = `${name}: ${v}`;
        callback(v);
      });

      wrap.appendChild(slider);
      paramBox.appendChild(wrap);
    }

    addSlider("最低速度", minRate.toFixed(2), 1.00, 3.00, 0.05, v => { minRate = v; recomputeRates(); });
    addSlider("最高速度", maxRate.toFixed(2), 2.00, 5.00, 0.05, v => { maxRate = v; recomputeRates(); });

    addSlider("指数(変化の緩やかさ)", expPower.toFixed(1), 1.0, 10.0, 0.1, v => { expPower = v; recomputeRates(); });
    addSlider("シグモイド(変化の大きさ)", sigmoidK, 1, 50, 1, v => { sigmoidK = v; recomputeRates(); });
    addSlider("シグモイド(境目)", sigmoidCenter, 0, 1, 0.01, v => { sigmoidCenter = v; recomputeRates(); });

    // addSlider("対数オフセット", logOffset, 0, 2, 0.01, v => { logOffset = v; recomputeRates(); });
    addSlider("分位数(分割数)", quantileBins, 2, 20, 1, v => { quantileBins = Math.floor(v); recomputeRates(); });

    document.body.appendChild(panel);
    currentPanel = panel;

    return {
      drawWaveform,
      updateSpeed: (txt) => speedDisplay.textContent = txt
    };
  }

  // メイン制御
  async function main() {
    const video = getVideo();
    if (!video) return;

    currentVideoId = new URL(location.href).searchParams.get("v");

    const ui = createPanel(video);

    // 波形チェック 
    setInterval(() => {
      const vid = new URL(location.href).searchParams.get("v");
      if (vid !== currentVideoId) {
        currentVideoId = vid;
        currentWaveform = null;
        ratesByAlgo = null;
        ui.drawWaveform(0);
      }

      const wf = getHeatmapWaveformOnce();
      if (wf) {
        currentWaveform = wf;
        recomputeRates();
      } else {
        currentWaveform = null;
        ratesByAlgo = null;
      }

      const v = getVideo();
      if (v && v.duration) ui.drawWaveform(v.currentTime / v.duration);
    }, checkInterval);

    // 自動速度更新
    setInterval(() => {
      const v = getVideo();
      if (!v || v.duration === 0) return;

      if (manualMode) return;

      if (!ratesByAlgo || !currentWaveform) {
        applyPlaybackRate(v, 1.0);
        ui.updateSpeed("速度: 1.00x");
        return;
      }

      const p = v.currentTime / v.duration;
      const idx = Math.floor(p * (currentWaveform.length - 1));
      const arr = ratesByAlgo[currentAlgo];
      const rate = arr?.[idx] ?? 1.0;

      applyPlaybackRate(v, rate);
      ui.updateSpeed(`速度: ${rate.toFixed(2)}x (${currentAlgo})`);
    }, updateInterval * 1000);
  }

  window.addEventListener("yt-navigate-finish", main);
  if (document.readyState === "complete") main();
})();
