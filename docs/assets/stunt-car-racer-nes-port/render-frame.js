function createFrameViewer(root, dat) {
  const magnification = 2
  const canvas = document.createElement('canvas');
  canvas.width = 256 * magnification;
  canvas.height = 200 * magnification;

  const controls = document.createElement('div');
  controls.style.display = 'flex';

  const playToggleButton = document.createElement('button');
  playToggleButton.style.width = '32px';

  const svgNamespace = 'http://www.w3.org/2000/svg';
  const pathPlay = document.createElementNS(svgNamespace, 'path');
  pathPlay.setAttribute('d', 'M8 5v14l11-7z');
  const playIcon = document.createElementNS(svgNamespace, 'svg');
  playIcon.setAttribute('viewBox', '0 0 24 24');
  playIcon.appendChild(pathPlay);

  const pathPause = document.createElementNS(svgNamespace, 'path');
  pathPause.setAttribute('d', 'M6 19h4V5H6v14zm8-14v14h4V5h-4z');
  const pauseIcon = document.createElementNS(svgNamespace, 'svg');
  pauseIcon.setAttribute('viewBox', '0 0 24 24');
  pauseIcon.style.display = 'none';
  pauseIcon.appendChild(pathPause);

  playToggleButton.appendChild(playIcon);
  playToggleButton.appendChild(pauseIcon);
  controls.appendChild(playToggleButton);

  const seekBar = document.createElement('input');
  seekBar.type = 'range';
  seekBar.value = '0';
  seekBar.style.flexGrow = '1';
  controls.appendChild(seekBar);

  root.style.width = canvas.width + 'px';
  root.style.margin = '1em auto';
  root.appendChild(canvas);
  root.appendChild(controls);

  const ctx = canvas.getContext('2d');
  const renderCanvas = document.createElement('canvas');
  renderCanvas.width = 0x100;
  renderCanvas.height = 0x100;
  const renderCtx = renderCanvas.getContext('2d');
  const renderImageData = renderCtx.createImageData(256, 200);
  const pixels = renderImageData.data;

  const specialFrameSizes = [3, 10, 6]
  let totalFrames = 0;
  for (let i = 0x400; i < dat.length;) {
    const address = dat[i] | (dat[i + 1] << 8);
    totalFrames++;
    if (address < 0xff00) {
      i += 3;
    } else {
      i += specialFrameSizes[address & 0xff];
    }
  }

  const highlightDuration = 100;
  seekBar.max = totalFrames + highlightDuration;
  seekBar.value = 0;
  let currentFrame = 0;
  let isPlaying = false;
  let animationFrameId = null;

  let lastAddress = 0;
  let lastValue = 0;

  function renderAnimationFrame(frameNumber) {
    const nameTable = [];
    const patterns = [];
    const highlightFrames = [];
    const attributes = [];
    for (let i = 0; i < 0xe10; i++) {
      patterns[i] = i > 0x10 ? -1 : i >= 0x08 ? 0x00 : 0xff;
    }
    for (let i = 0x10; i < 0x200; i++) {
      patterns.push(dat[i]);
    }
    for (let i = 0; i < 0x200; i++) {
      nameTable.push(i < 0x20 ? 0x00 : dat[i + 0x200]);
      highlightFrames.push(-1);
    }
    for (let i = 1; i < 0x10; i++) {
      patterns[0xe0 + i] = dat[i + 0x200];
      patterns[0x1c0 + i] = dat[i + 0x210];
    }
    for (let i = 0; i < 0x100; i++) {
      attributes.push(i < 0xe1 || i >= 0xfb ? 0 : 1);
    }
    const wheelOffsetLeft = dat[0x200];
    const wheelOffsetRight = dat[0x210];
    if (wheelOffsetLeft > 8) {
      attributes[0x05] = 1;
      attributes[0x0a] = 1;
    }
    if (wheelOffsetLeft > 16) {
      attributes[0x04] = 1;
      attributes[0x09] = 1;
    }
    if (wheelOffsetRight > 8) {
      attributes[0x13] = 1;
      attributes[0x18] = 1;
    }
    if (wheelOffsetRight > 16) {
      attributes[0x12] = 1;
      attributes[0x17] = 1;
    }

    let i = 0x400;
    for (let frame = 0; frame < Math.min(frameNumber, totalFrames); frame++) {
      const address = dat[i] | (dat[i + 1] << 8);
      const value = dat[i + 2] | 0;
      if (address < 0xff00) {
        i += 3;
      } else {
        i += specialFrameSizes[address & 0xff];
      }
      if (address < 0x400) {
        continue;
      }
      lastAddress = address;
      lastValue = value;
      switch (address >> 8) {
        case 0xff:
          break;
        default:
          if (address < 0x6400) {
            nameTable[address & 0x1ff] = value;
            highlightFrames[address & 0x1ff] = frame;
          } else {
            patterns[address - 0x6400 + 0x10] = value;
          }
          break;
      }
    }

    const pal0 = [0x000000, 0x894600, 0x57a5ff, 0xffffff, 0xff00ff, 0xffff00];
    const pal1 = [0x000000, 0x006d90, 0x57a5ff, 0xffffff, 0xff00ff, 0xffff00];

    const showMasks = false;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    function drawTile(tx, ty, tile, highlight) {
      for (let py = 0; py < 8; py++) {
        const b0 = patterns[(tile << 4) + py];
        const b1 = patterns[(tile << 4) + py + 8];
        const y = (ty << 3) + py;
        for (let px = 0; px < 8; px++) {
          const cid = b0 < 0 ? 4 : b1 < 0 ? 5 : ((b0 >> (7 - px)) & 1) | (((b1 >> (7 - px)) & 1) << 1);
          const x = (tx << 3) + px;
          const pi = (y << 10) + (x << 2);
          const col = attributes[tile] == 0 ? pal0[cid] : pal1[cid];
          pixels[pi + 0] = (col >> 16) & 0xff;
          pixels[pi + 1] = (col >> 8) & 0xff;
          pixels[pi + 2] = col & 0xff;
          pixels[pi + 3] = 0xff;
          if (highlight > 0 && (py == 0 || py == 7 || px == 0 || px == 7)) {
            pixels[pi + 1] = (pixels[pi + 1] * (highlightDuration - highlight) + 0xff * highlight) / highlightDuration;
          }
        }
      }    
    }

    function plotPixel(x, y, col) {
      const pi = (y << 10) + (x << 2);
      for (let i = 0; i < 4; i++) {
        pixels[pi + i] = (col >> (i << 3)) & 0xff;
      }
    }

    for (let ty = 0; ty < 16; ty++) {
      for (let tx = 0; tx < 32; tx++) {
        const ofs = (ty << 5) + tx;
        const tile = nameTable[ofs];
        const highlightFrame = highlightFrames[ofs];
        const highlight = highlightFrame < 0 ? 0 : Math.max(0, highlightDuration - frameNumber + highlightFrame);
        drawTile(tx, ty, tile, highlight);
      }
    }

    for (let ty = 0; ty < 8; ty++) {
      for (let tx = 0; tx < 32; tx++) {
        const tile = (ty << 5) + tx;
        drawTile(tx, ty + 17, tile, 0, 8);
      }
    }

    renderCtx.putImageData(renderImageData, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(renderCanvas, 0, 0, 0x100 * magnification, 0x100 * magnification);
  }

  function animationLoop() {
    if (!isPlaying) return;

    renderAnimationFrame(currentFrame);
    updateUI();

    currentFrame++;  
    if (currentFrame >= seekBar.max) {
      currentFrame = 0; 
    }

    animationFrameId = requestAnimationFrame(animationLoop);
  }

  function updateUI() {
    seekBar.value = currentFrame;
  }

  playToggleButton.addEventListener('click', () => {
    isPlaying = !isPlaying;
    
    if (isPlaying) {
      playIcon.style.display = 'none';
      pauseIcon.style.display = 'inline';
      animationLoop();
    } else {
      playIcon.style.display = 'inline';
      pauseIcon.style.display = 'none';
      cancelAnimationFrame(animationFrameId);
    }
  });

  seekBar.addEventListener('input', (e) => {
    currentFrame = parseInt(e.target.value, 10);
    renderAnimationFrame(currentFrame);
  });

  currentFrame = seekBar.max - 1;
  renderAnimationFrame(currentFrame);
  updateUI();
}