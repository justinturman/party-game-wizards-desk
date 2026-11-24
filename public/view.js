(function () {
  const root = document.getElementById('root');

  // Anything players typed (their nicknames) is escaped before it goes into the page
  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );
  const send = (name, ...args) => parent.postMessage({ type: 'move', name, args }, '*');
  const $ = (id) => document.getElementById(id);

  // Object n has colour n. Names and colours must match cards.js and the drawings in index.html.
  const OBJECTS = [
    { name: 'White Owl', sym: 'owl', color: '#f4f4f4' },
    { name: 'Red Candle', sym: 'candle', color: '#e53935' },
    { name: 'Green Frog', sym: 'frog', color: '#43a047' },
    { name: 'Blue Crystal', sym: 'crystal', color: '#1e88e5' },
    { name: 'Grey Key', sym: 'key', color: '#9e9e9e' },
  ];
  const PALETTE = ['#ff5252', '#448aff', '#69f0ae', '#ffd740', '#e040fb', '#18ffff', '#ff6e40', '#b2ff59',
                   '#ff80ab', '#b388ff', '#84ffff', '#ffab40', '#ccff90', '#f48fb1', '#80d8ff', '#ea80fc'];
  const colorOf = (id) => PALETTE[Number(id) % PALETTE.length];
  const nameOf = (names, id) => esc(names[id] || `Player ${Number(id) + 1}`);
  const SLOTS = {
    2: [[80, 100], [220, 100]],
    3: [[78, 58], [222, 58], [150, 146]],
    4: [[80, 56], [220, 56], [80, 144], [220, 144]],
  };

  let last = null; // the most recent message from the platform
  let layoutKey = null; // which screen layout is currently built
  let rs = { gameNo: -1, score: null, lastSeq: null, coolUntil: 0 }; // what this phone knows about the current game
  let toastUntil = 0;

  // ---------------- Reliable taps ----------------
  // A tap carries a sequence number. We send one at a time and resend it until the
  // server's count (mySeq) shows it was accepted, so a tap is never lost or counted twice.
  // A tap meant for a card that has already gone is dropped: somebody else was faster.
  const rel = { queue: [], inflight: null, sentAt: 0, ack: 0 };
  function relReset() {
    rel.queue = [];
    rel.inflight = null;
  }
  function relSend() {
    const op = rel.inflight;
    if (!op) return;
    op.seq = rel.ack + 1;
    rel.sentAt = Date.now();
    send('tap', op.seq, op.card, op.obj);
  }
  function relPump() {
    const S = last && last.state.G;
    while (rel.queue.length && S && rel.queue[0].card !== S.cardNo) rel.queue.shift();
    if (!rel.inflight && rel.queue.length) {
      rel.inflight = rel.queue.shift();
      rel.inflight.base = rel.ack;
      rel.inflight.tries = 0;
      relSend();
    }
  }
  function relAck(ack) {
    rel.ack = ack;
    if (rel.inflight && rel.ack > rel.inflight.base) rel.inflight = null;
    relPump();
  }

  // ---------------- Drawing the objects and the card ----------------
  const icon = (shape, color) =>
    `<svg viewBox="0 0 100 100" aria-hidden="true"><use href="#s-${OBJECTS[shape].sym}" style="color:${OBJECTS[color].color}"/></svg>`;

  function cardHTML(items) {
    const slots = SLOTS[items.length] || SLOTS[4];
    const parts = items.map(([shape, colour], i) => {
      const [x, y] = slots[i];
      const rot = ((shape * 37 + colour * 17 + i * 23) % 29) - 14; // the same tilt on every screen
      return `<g transform="translate(${x} ${y}) rotate(${rot})"><use href="#s-${OBJECTS[shape].sym}" x="-42" y="-42" width="84" height="84" style="color:${OBJECTS[colour].color}"/></g>`;
    });
    return `<svg class="card" viewBox="0 0 300 200"><rect x="3" y="3" width="294" height="194" rx="18" fill="#f3e6c8" stroke="#2b2140" stroke-width="5"/>${parts.join('')}</svg>`;
  }

  const deskHTML = () =>
    '<div class="desk">' +
    OBJECTS.map((o, i) => `<div class="deskitem"><div class="ico">${icon(i, i)}</div><div>${o.name}</div></div>`).join('') +
    '</div>';

  const RULES_HTML = `<ol class="rules">
      <li>A card is turned over. It shows some of the five objects, in all sorts of colours.</li>
      <li>If an object is shown in <b>its own colour</b> (the Green Frog in green, the Red Candle in red…), tap that object.</li>
      <li>If <b>no</b> object is in its own colour, tap the object whose <b>shape and colour are both missing</b> from the card.</li>
      <li>The first right tap wins the card and a point. A wrong tap freezes you for a few seconds.</li>
    </ol>`;

  function lastText(L, names) {
    if (!L) return '';
    const o = OBJECTS[L.obj].name;
    const why =
      L.kind === 'own'
        ? 'It was in its own colour.'
        : 'Neither its shape nor its colour was on the card.';
    return `<strong>${nameOf(names, L.by)}</strong> took the ${o}! ${why}`;
  }

  function winnersText(S, names) {
    if (!S.winners.length) return 'Nobody scored this time';
    const who = S.winners.map((id) => nameOf(names, id)).join(' &amp; ');
    const n = S.scores[S.winners[0]];
    return S.winners.length === 1
      ? `🏆 ${who} wins with ${n}!`
      : `🤝 It's a tie: ${who} (${n} each)`;
  }

  // Builds a screen layout once. Later updates only change the parts inside it,
  // so the buttons are never torn down while a player is tapping them.
  function layout(key, html, onBuild) {
    if (key === layoutKey) return;
    layoutKey = key;
    root.innerHTML = html;
    if (onBuild) onBuild();
  }

  // Everyone who has joined, with their points. People who left show as "away"
  // (and are hidden if they never scored).
  function rosterOf(msg, S) {
    const rows = [];
    const seen = new Set();
    (msg.players || []).forEach((p) => {
      const id = String(p.id);
      seen.add(id);
      const pts = S.scores[id] || 0;
      if (p.connected || pts > 0) rows.push({ id, name: p.name, pts, away: !p.connected });
    });
    Object.keys(S.scores).forEach((id) => {
      if (!seen.has(id)) rows.push({ id, name: msg.names[id] || `Player ${Number(id) + 1}`, pts: S.scores[id], away: true });
    });
    rows.sort((a, b) => b.pts - a.pts || a.name.localeCompare(b.name));
    return rows;
  }

  function scoresHTML(rows) {
    if (!rows.length) return '<p class="progress">Waiting for players to join…</p>';
    return (
      '<ul class="scores">' +
      rows
        .map(
          (r) => `<li class="${r.away ? 'away' : ''}">
            <span class="dot" style="background:${colorOf(r.id)}"></span>
            <span class="pname">${esc(r.name)}${r.away ? ' (away)' : ''}</span><strong>${r.pts}</strong></li>`
        )
        .join('') +
      '</ul>'
    );
  }

  // ---------------- TV and spectators ----------------
  function tvScreen(msg) {
    const { names, state } = msg;
    const S = state.G;
    layout(
      `tv:${S.phase}`,
      `<div style="max-width:1200px;margin:0 auto">
         <h1>🧙 Wizard's Desk</h1>
         <div id="banner"></div>
         <div style="display:flex;flex-wrap:wrap;gap:20px;justify-content:center;align-items:flex-start">
           <div id="main" style="flex:1 1 480px;min-width:0;max-width:760px"></div>
           <div id="side" style="flex:0 1 340px;min-width:260px"></div>
         </div>
       </div>`
    );
    const rows = rosterOf(msg, S);
    if (S.phase === 'ready') {
      $('banner').innerHTML = '<h2>Tap “Start game” on any phone when everyone is ready</h2>';
      $('main').innerHTML = RULES_HTML + deskHTML();
      $('side').innerHTML = '<h2>Players</h2>' + scoresHTML(rows);
    } else if (S.phase === 'playing') {
      $('banner').innerHTML = '';
      $('main').innerHTML = `<p class="progress">Card ${S.cardNo + 1} of ${S.total}</p>
        <div style="max-width:560px;margin:0 auto">${cardHTML(S.card)}</div>
        ${deskHTML()}
        <p class="progress">Own colour? Tap it. None? Tap the object missing in both shape and colour.</p>`;
      $('side').innerHTML = `<div class="lasttext" style="font-size:1.25rem">${lastText(S.last, names)}</div>` + scoresHTML(rows);
    } else {
      $('banner').innerHTML = `<h2>${winnersText(S, names)}</h2><p>Tap “Play again” on any phone.</p>`;
      $('main').innerHTML = deskHTML();
      $('side').innerHTML = '<h2>Final scores</h2>' + scoresHTML(rows);
    }
  }

  // ---------------- A player's phone ----------------
  function toast(text, ms) {
    const t = $('toast');
    if (!t) return;
    t.textContent = text;
    t.hidden = false;
    toastUntil = Date.now() + (ms || 1600);
  }

  function tapObj(obj) {
    if (!last || last.view !== 'player') return;
    const S = last.state.G;
    if (S.phase !== 'playing') return;
    if (Date.now() < rs.coolUntil) return;
    if (rel.queue.length >= 2) return;
    rel.queue.push({ obj, card: S.cardNo });
    relPump();
  }

  const topline = '<div class="topline"><span id="me"></span><span id="mypts"></span></div>';

  function phoneScreen(msg) {
    const { names, state, playerID } = msg;
    const S = state.G;
    const my = S.scores[playerID] || 0;

    if (S.phase === 'ready') {
      layout(
        'p:ready',
        `${topline}<h2>🧙 Wizard's Desk</h2>${RULES_HTML}${deskHTML()}
         <p><button id="start" class="big good">Start game</button></p>`,
        () => {
          const b = $('start');
          b.onclick = () => {
            b.disabled = true;
            send('startGame', last.state.G.gameNo);
            setTimeout(() => { if (b.isConnected) b.disabled = false; }, 2500); // refused, so let them try again
          };
        }
      );
    } else if (S.phase === 'playing') {
      layout(
        'p:playing',
        `${topline}
         <div id="info" class="progress"></div>
         <div id="cardbox" style="max-width:340px;margin:0 auto"></div>
         <div id="banner" class="lasttext"></div>
         <div id="frozen" class="frozen-note" hidden></div>
         <div id="grid" style="display:flex;flex-wrap:wrap;justify-content:center;gap:10px;max-width:520px;margin:10px auto">
           ${OBJECTS.map(
             (o, i) => `<button class="objbtn" data-obj="${i}" style="flex:0 0 30%">
               <div class="ico">${icon(i, i)}</div>${o.name}</button>`
           ).join('')}
         </div>
         <details><summary>How to play</summary>${RULES_HTML}</details>
         <div id="toast" class="toast" hidden></div>`,
        () => {
          root.querySelectorAll('[data-obj]').forEach((b) => {
            b.onclick = () => tapObj(Number(b.dataset.obj));
          });
        }
      );
      $('info').textContent = `Card ${S.cardNo + 1} of ${S.total}`;
      $('cardbox').innerHTML = S.card ? cardHTML(S.card) : '';
      $('banner').innerHTML = lastText(S.last, names);
    } else {
      layout(
        'p:done',
        `${topline}<h2 id="result"></h2><p><button id="again" class="big good">Play again ▶</button></p>`,
        () => {
          const b = $('again');
          b.onclick = () => {
            b.disabled = true;
            send('startGame', last.state.G.gameNo);
            setTimeout(() => { if (b.isConnected) b.disabled = false; }, 2500);
          };
        }
      );
      $('result').innerHTML = winnersText(S, names);
    }

    // Feedback for my own taps
    if (rs.score === null || my < rs.score) rs.score = my;
    if (my > rs.score) {
      rs.score = my;
      if (S.last && S.last.by === playerID) toast(`✅ +1 ${OBJECTS[S.last.obj].name}!`);
    }
    if (rs.lastSeq === null) {
      if (S.cool > 0) rs.coolUntil = Date.now() + S.cool;
    } else if (S.mySeq !== rs.lastSeq && S.cool > 0) {
      rs.coolUntil = Date.now() + S.cool;
      toast(`❌ Wrong! Frozen for ${Math.ceil(S.cool / 1000)}s`, 1800);
    }
    rs.lastSeq = S.mySeq;

    $('me').textContent = names[playerID] || `Player ${Number(playerID) + 1}`;
    $('mypts').textContent = `⭐ ${my}`;
  }

  // ---------------- Render ----------------
  function render(msg) {
    last = msg;
    const S = msg.state.G;
    if (msg.view === 'player') {
      if (rs.gameNo !== S.gameNo) {
        rs = { gameNo: S.gameNo, score: null, lastSeq: null, coolUntil: 0 };
        relReset();
      }
      relAck(S.mySeq);
      if (S.phase !== 'playing') relReset();
      else if (rel.inflight && rel.inflight.card !== S.cardNo) rel.inflight = null;
      phoneScreen(msg);
    } else {
      tvScreen(msg);
    }
  }

  // Several times a second: the freeze countdown, messages fading, and resending unconfirmed taps
  setInterval(() => {
    const now = Date.now();
    const fz = $('frozen');
    if (fz) {
      const left = rs.coolUntil - now;
      fz.hidden = !(left > 0);
      if (left > 0) fz.textContent = `❄️ Frozen ${Math.ceil(left / 1000)}s`;
    }
    const grid = $('grid');
    if (grid) grid.classList.toggle('frozen', rs.coolUntil > now);
    const t = $('toast');
    if (t && !t.hidden && now > toastUntil) t.hidden = true;
    if (rel.inflight && now - rel.sentAt > 700) {
      rel.inflight.tries += 1;
      if (rel.inflight.tries > 5) {
        rel.inflight = null;
        relPump();
      } else {
        relSend();
      }
    }
  }, 200);

  window.addEventListener('message', (e) => {
    if (e.source === parent && e.data && e.data.type === 'state') render(e.data);
  });
  parent.postMessage({ type: 'ready' }, '*');
})();