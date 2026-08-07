const ANALYSIS_DISTANCE_KM = 0.2;

const map = L.map('map', { doubleClickZoom: true }).setView([37.4948, 139.9298], 14);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 20,
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

const routeGroup = L.layerGroup().addTo(map);
const areaGroup = L.layerGroup().addTo(map);
const utilityGroup = L.layerGroup().addTo(map);
const locationGroup = L.layerGroup().addTo(map);

const $ = id => document.getElementById(id);

const locateBtn = $('locateBtn');
const startRouteBtn = $('startRouteBtn');
const finishRouteBtn = $('finishRouteBtn');
const setTolBtn = $('setTolBtn');
const analyzeBtn = $('analyzeBtn');
const resetBtn = $('resetBtn');
const modeMessage = $('modeMessage');
const checks = $('checks');
const template = $('checkTemplate');
const analysisState = $('analysisState');
const objectCount = $('objectCount');
const routeCount = $('routeCount');
const tolCount = $('tolCount');

const stepLocation = $('stepLocation');
const stepRoute = $('stepRoute');
const stepTol = $('stepTol');
const stepAnalyze = $('stepAnalyze');
const stepCheck = $('stepCheck');
const workflowHint = $('workflowHint');

const routeStatus = $('routeStatus');
const tolStatus = $('tolStatus');
const locationStatus = $('locationStatus');

let mode = null;

let routeLatLngs = [];
let routeLine = null;
let route = null;
let routeBuffer = null;

let tolMarker = null;
let tol = null;
let tolBuffer = null;

let currentLocationMarker = null;
let currentAccuracyCircle = null;
let currentCoords = null;

let hasAnalyzed = false;

const DEF = {
  route: {
    type: 'ROUTE-RELATED CHECK',
    title: '予定飛行経路周辺の架空線・電柱等を現地確認',
    action: '現地で、電線、通信線、支線等の有無、実際の位置、延伸方向、高さ、および予定飛行経路との関係を確認してください。',
    response: '必要な確認または十分な離隔を確保できない場合は、予定飛行経路または運航方法を再検討してください。',
    limitation: '利用可能な地図データには、すべての電線、通信線、支線、付属設備が登録されているとは限りません。地図情報のみで確認を完了しないでください。',
    source: 'MLIT-M01 / M02 / M03 · SORA-informed S01 / S02'
  },
  tol: {
    type: 'TAKEOFF / LANDING CHECK',
    title: '離着陸地点の上空・周辺の線状障害物を現地確認',
    action: '離着陸地点の上空と周辺について、電線、通信線、支線等の実際の位置・高さ・方向、および離着陸時の機体移動方向との関係を確認してください。',
    response: '十分な周辺確認または必要な離隔を確保できない場合は、離着陸地点または運航計画を再検討してください。',
    limitation: '地図上に表示されない細い線状障害物や付属設備が存在する可能性があります。現地確認が必要です。',
    source: 'MLIT-M02 / M03 · SORA-informed S01 / S02'
  },
  baseline: {
    type: 'BASELINE ON-SITE CHECK',
    title: '地図上で未検出でも、架空線等の有無を現地確認',
    action: '予定飛行経路および離着陸地点の周辺を現地で確認し、電線、通信線、支線その他の線状障害物が運航に影響しないことを確認してください。',
    response: '現地で障害物が確認された場合は、その位置・方向・視認性を確認し、必要に応じて予定飛行経路または離着陸地点を再検討してください。',
    limitation: '地図上で対象が確認されなかったことは、実際の環境に障害物が存在しないことを意味しません。',
    source: 'MLIT-M02 / M03 · Incident-informed uncertainty handling'
  }
};

function setMode(nextMode, icon, text) {
  mode = nextMode;
  modeMessage.innerHTML = `<span class="mode-icon">${icon}</span><span>${text}</span>`;
  map.getContainer().style.cursor = nextMode ? 'crosshair' : '';
}

function markStep(el, state) {
  el.classList.remove('active', 'done');
  if (state) el.classList.add(state);
}

function updateWorkflow() {
  const routeDone = !!route;
  const tolDone = !!tol;

  markStep(stepLocation, currentCoords ? 'done' : null);
  stepLocation.classList.add('optional');

  if (!routeDone) {
    markStep(stepRoute, 'active');
    markStep(stepTol, null);
    markStep(stepAnalyze, null);
    markStep(stepCheck, null);
    workflowHint.textContent = 'Step 1：まず地図上で予定飛行経路を描いてください。';
  } else if (!tolDone) {
    markStep(stepRoute, 'done');
    markStep(stepTol, 'active');
    markStep(stepAnalyze, null);
    markStep(stepCheck, null);
    workflowHint.textContent = 'Step 2：次に離着陸地点を1か所設定してください。';
  } else if (!hasAnalyzed) {
    markStep(stepRoute, 'done');
    markStep(stepTol, 'done');
    markStep(stepAnalyze, 'active');
    markStep(stepCheck, null);
    workflowHint.textContent = 'Step 3：入力がそろいました。「分析を実行」を押してください。';
  } else {
    markStep(stepRoute, 'done');
    markStep(stepTol, 'done');
    markStep(stepAnalyze, 'done');
    markStep(stepCheck, 'active');
    workflowHint.textContent = 'Step 4：右側に表示された確認事項を、実際の飛行場所で確認してください。';
  }

  routeStatus.className = `input-status ${routeDone ? 'done' : 'pending'}`;
  routeStatus.querySelector('small').textContent =
    routeDone ? `${routeLatLngs.length}点で経路を設定済み` : '未設定';

  tolStatus.className = `input-status ${tolDone ? 'done' : 'pending'}`;
  tolStatus.querySelector('small').textContent =
    tolDone ? '離着陸地点を設定済み' : '未設定';

  locationStatus.className =
    `input-status ${currentCoords ? 'done' : 'optional-status'}`;
  locationStatus.querySelector('small').textContent =
    currentCoords ? '現在地を地図に表示中' : '未表示（任意）';

  finishRouteBtn.disabled = routeLatLngs.length < 2;
  setTolBtn.disabled = !routeDone;
  analyzeBtn.disabled = !(routeDone && tolDone);
}

function resetAnalysis() {
  utilityGroup.clearLayers();
  objectCount.textContent = routeCount.textContent = tolCount.textContent = '—';
  analysisState.className = 'state-badge';
  analysisState.textContent = '未分析';
  hasAnalyzed = false;
  checks.innerHTML = `
    <div class="empty-state">
      まだ分析していません。<br>
      左の地図で <b>飛行経路 → 離着陸地点 → 分析</b> の順に設定してください。
    </div>`;
  updateWorkflow();
}

function redrawRoute() {
  routeGroup.clearLayers();

  routeLatLngs.forEach((ll, index) => {
    const marker = L.circleMarker(ll, {
      radius: 5,
      weight: 2,
      color: '#18587c',
      fillColor: '#fff',
      fillOpacity: 1
    }).addTo(routeGroup);

    marker.bindTooltip(`経路点 ${index + 1}`, {
      direction: 'top',
      opacity: 0.85
    });
  });

  if (routeLatLngs.length >= 2) {
    routeLine = L.polyline(routeLatLngs, {
      color: '#18587c',
      weight: 4
    }).addTo(routeGroup);
  }

  updateWorkflow();
}

function redrawAreas() {
  areaGroup.clearLayers();

  if (routeBuffer) {
    L.geoJSON(routeBuffer, {
      style: {
        color: '#587d91',
        weight: 2,
        fillColor: '#8ca9b8',
        fillOpacity: 0.18
      },
      interactive: false
    }).addTo(areaGroup);
  }

  if (tol) {
    tolBuffer = turf.buffer(tol, ANALYSIS_DISTANCE_KM, {
      units: 'kilometers'
    });

    L.geoJSON(tolBuffer, {
      style: {
        color: '#666',
        weight: 1.5,
        dashArray: '5 5',
        fillColor: '#999',
        fillOpacity: 0.08
      },
      interactive: false
    }).addTo(areaGroup);
  }
}

function buildRoute() {
  route = turf.lineString(routeLatLngs.map(ll => [ll.lng, ll.lat]));
  routeBuffer = turf.buffer(route, ANALYSIS_DISTANCE_KM, {
    units: 'kilometers'
  });
  redrawAreas();
}

function clearTol() {
  if (tolMarker) map.removeLayer(tolMarker);
  tolMarker = null;
  tol = null;
  tolBuffer = null;
  redrawAreas();
}

locateBtn.addEventListener('click', () => {
  if (!navigator.geolocation) {
    setMode(null, '!', 'このブラウザでは現在地取得に対応していません。');
    return;
  }

  locateBtn.disabled = true;
  locateBtn.textContent = '現在地を取得中…';

  navigator.geolocation.getCurrentPosition(
    position => {
      const { latitude, longitude, accuracy } = position.coords;
      currentCoords = { latitude, longitude, accuracy };

      locationGroup.clearLayers();

      currentAccuracyCircle = L.circle([latitude, longitude], {
        radius: accuracy,
        color: '#2478c5',
        weight: 1.5,
        fillColor: '#5da8df',
        fillOpacity: 0.12,
        className: 'current-location-pulse'
      }).addTo(locationGroup);

      currentLocationMarker = L.circleMarker([latitude, longitude], {
        radius: 7,
        color: '#ffffff',
        weight: 3,
        fillColor: '#2478c5',
        fillOpacity: 1
      }).addTo(locationGroup);

      currentLocationMarker.bindTooltip(
        `現在地（精度 約${Math.round(accuracy)} m）`,
        { permanent: false, direction: 'top', className: 'current-tooltip' }
      );

      map.setView([latitude, longitude], 17);

      setMode(
        null,
        '◎',
        `現在地を表示しました（位置精度 約${Math.round(accuracy)} m）。これは飛行経路や離着陸地点の入力とは別です。`
      );

      locateBtn.textContent = '◎ 現在地を再取得';
      locateBtn.disabled = false;
      updateWorkflow();
    },
    error => {
      const messages = {
        1: '位置情報の利用が許可されていません。ブラウザの位置情報設定を確認してください。',
        2: '現在地を取得できませんでした。GPSやネットワーク接続を確認してください。',
        3: '現在地の取得がタイムアウトしました。もう一度お試しください。'
      };

      setMode(null, '!', messages[error.code] || '現在地を取得できませんでした。');
      locateBtn.textContent = '◎ 現在地を表示';
      locateBtn.disabled = false;
    },
    {
      enableHighAccuracy: true,
      timeout: 12000,
      maximumAge: 30000
    }
  );
});

startRouteBtn.addEventListener('click', () => {
  routeGroup.clearLayers();
  areaGroup.clearLayers();
  utilityGroup.clearLayers();

  routeLatLngs = [];
  routeLine = null;
  route = null;
  routeBuffer = null;

  clearTol();
  resetAnalysis();

  setMode(
    'route',
    '1',
    '地図上を順番にクリックして飛行経路を描いてください。2点以上入力したら「経路を確定」を押します。'
  );
  updateWorkflow();
});

finishRouteBtn.addEventListener('click', () => {
  if (routeLatLngs.length < 2) return;

  buildRoute();
  setMode(
    null,
    '2',
    '経路を確定しました。次に「2. 離着陸地点を設定」を押し、地図を1回クリックしてください。'
  );

  if (routeLine) map.fitBounds(routeLine.getBounds().pad(0.35));
  updateWorkflow();
});

setTolBtn.addEventListener('click', () => {
  setMode(
    'tol',
    '2',
    '離着陸する予定の地点を、地図上で1回クリックしてください。'
  );
});

resetBtn.addEventListener('click', () => {
  routeGroup.clearLayers();
  areaGroup.clearLayers();
  utilityGroup.clearLayers();

  if (tolMarker) map.removeLayer(tolMarker);

  mode = null;
  routeLatLngs = [];
  routeLine = null;
  route = null;
  routeBuffer = null;
  tolMarker = null;
  tol = null;
  tolBuffer = null;

  resetAnalysis();

  setMode(
    null,
    '1',
    '「経路入力開始」を押し、地図を2点以上クリックしてください。現在地表示はそのまま残ります。'
  );

  updateWorkflow();
});

map.on('click', e => {
  if (mode === 'route') {
    routeLatLngs.push(e.latlng);
    redrawRoute();

    setMode(
      'route',
      '1',
      `${routeLatLngs.length}点入力しました。続けて経路点を追加するか、「経路を確定」を押してください。`
    );
    return;
  }

  if (mode === 'tol') {
    clearTol();

    tolMarker = L.marker(e.latlng)
      .addTo(map)
      .bindPopup('<strong>離着陸地点</strong><br>この地点を中心に周辺情報も確認します。')
      .openPopup();

    tol = turf.point([e.latlng.lng, e.latlng.lat]);
    redrawAreas();
    resetAnalysis();

    setMode(
      null,
      '3',
      '離着陸地点を設定しました。入力が正しければ「3. 分析を実行」を押してください。'
    );

    updateWorkflow();
  }
});

function queryFor(bbox) {
  const [w, s, e, n] = bbox;
  return `[out:json][timeout:25];
(
  nwr["power"~"^(pole|tower|line|minor_line)$"](${s},${w},${n},${e});
  nwr["man_made"="utility_pole"](${s},${w},${n},${e});
);
out geom;`;
}

async function fetchOverpass(query) {
  let lastError;

  for (const endpoint of [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter'
  ]) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
        },
        body: 'data=' + encodeURIComponent(query)
      });

      if (!response.ok) throw new Error('HTTP ' + response.status);
      return await response.json();
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
}

function intersects(feature, polygon) {
  try {
    return !!(feature && feature.geometry && polygon &&
      turf.booleanIntersects(feature, polygon));
  } catch {
    return false;
  }
}

function label(feature) {
  const p = feature.properties || {};
  if (p.power === 'pole') return 'Power pole / 電柱';
  if (p.power === 'tower') return 'Power tower / 鉄塔';
  if (p.power === 'line') return 'Power line / 送電線';
  if (p.power === 'minor_line') return 'Minor power line / 配電線';
  if (p.man_made === 'utility_pole') return 'Utility pole / ユーティリティ柱';
  return 'Utility infrastructure';
}

function distanceToRoute(feature) {
  try {
    if (intersects(feature, turf.buffer(route, 0.0001, {
      units: 'kilometers'
    }))) return 0;

    let min = Infinity;

    turf.flattenEach(feature, part => {
      const g = part.geometry;
      if (!g) return;

      if (g.type === 'Point') {
        min = Math.min(
          min,
          turf.pointToLineDistance(part, route, {
            units: 'kilometers'
          })
        );
      } else if (g.type === 'LineString') {
        g.coordinates.forEach(coord => {
          min = Math.min(
            min,
            turf.pointToLineDistance(turf.point(coord), route, {
              units: 'kilometers'
            })
          );
        });
      }
    });

    return Number.isFinite(min) ? min : null;
  } catch {
    return null;
  }
}

function renderUtility(features) {
  utilityGroup.clearLayers();

  features.forEach(feature => {
    const distance = distanceToRoute(feature);
    const distanceText = distance == null
      ? '予定経路との距離：取得できません'
      : `予定経路との最短距離：約${Math.round(distance * 1000)} m`;

    L.geoJSON(feature, {
      pointToLayer: (_, ll) =>
        L.circleMarker(ll, {
          radius: 6,
          color: '#8f3828',
          fillColor: '#b24830',
          fillOpacity: 0.9,
          weight: 2
        }),
      style: {
        color: '#b24830',
        weight: 4,
        opacity: 0.9
      },
      onEachFeature: (_, layer) =>
        layer.bindPopup(
          `<strong>${label(feature)}</strong><br>` +
          `${distanceText}<br>` +
          `<small>地図情報のみです。実物は現地で確認してください。</small>`
        )
    }).addTo(utilityGroup);
  });
}

function card(definition, context) {
  const node = template.content.cloneNode(true);

  node.querySelector('.check-type').textContent = definition.type;
  node.querySelector('.check-title').textContent = definition.title;
  node.querySelector('.check-context').textContent = context;
  node.querySelector('.check-action').textContent = definition.action;
  node.querySelector('.check-response').textContent = definition.response;
  node.querySelector('.check-limitation').textContent = definition.limitation;
  node.querySelector('.check-source').textContent = definition.source;

  const select = node.querySelector('.check-status');
  select.addEventListener('change', () => {
    const article = select.closest('.check-card');
    article.dataset.status = select.value;
  });

  return node;
}

function renderChecks(routeFeatures, tolFeatures, allFeatures) {
  checks.innerHTML = '';

  if (routeFeatures.length) {
    const distances = routeFeatures
      .map(distanceToRoute)
      .filter(value => value != null);

    const closest = distances.length
      ? Math.round(Math.min(...distances) * 1000)
      : null;

    const context =
      `${routeFeatures.length}件のユーティリティ関連地図オブジェクトが、` +
      `予定飛行経路から200 m以内で確認されました。` +
      (closest == null
        ? ''
        : ` 最も近い地図オブジェクトは予定経路から約${closest} mです。`);

    checks.appendChild(card(DEF.route, context));
  }

  if (tolFeatures.length) {
    const context =
      `${tolFeatures.length}件のユーティリティ関連地図オブジェクトが、` +
      `離着陸地点から200 m以内で確認されました。`;

    checks.appendChild(card(DEF.tol, context));
  }

  if (!allFeatures.length) {
    checks.appendChild(
      card(
        DEF.baseline,
        '利用可能なOpenStreetMapデータでは、今回の分析範囲内に対象タグのユーティリティ設備は確認されませんでした。'
      )
    );
  }
}

analyzeBtn.addEventListener('click', async () => {
  if (!(route && routeBuffer && tol && tolBuffer)) return;

  analyzeBtn.disabled = true;
  analysisState.className = 'state-badge loading';
  analysisState.textContent = '分析中';

  setMode(
    null,
    '3',
    'OpenStreetMapから対象情報を取得しています。少し待ってください…'
  );

  checks.innerHTML =
    '<div class="empty-state">地図情報を取得し、場所別の確認事項を作成しています…</div>';

  try {
    const bbox = turf.bbox(
      turf.featureCollection([routeBuffer, tolBuffer])
    );

    const osm = await fetchOverpass(queryFor(bbox));
    const geojson = osmtogeojson(osm);

    const all = (geojson.features || []).filter(
      feature =>
        intersects(feature, routeBuffer) ||
        intersects(feature, tolBuffer)
    );

    const routeFeatures = all.filter(feature =>
      intersects(feature, routeBuffer)
    );

    const tolFeatures = all.filter(feature =>
      intersects(feature, tolBuffer)
    );

    renderUtility(all);
    renderChecks(routeFeatures, tolFeatures, all);

    objectCount.textContent = all.length;
    routeCount.textContent = routeFeatures.length;
    tolCount.textContent = tolFeatures.length;

    analysisState.className = 'state-badge done';
    analysisState.textContent = '分析完了';
    hasAnalyzed = true;

    setMode(
      null,
      '4',
      all.length
        ? '分析が完了しました。地図上の赤い対象を確認し、右側の「現地で確認すること」を読んでください。'
        : '対象タグは地図上で確認されませんでした。ただし、障害物がないとは判断せず、右側のBaseline Checkを現地で確認してください。'
    );

    updateWorkflow();
  } catch (error) {
    console.error(error);

    analysisState.className = 'state-badge error';
    analysisState.textContent = '取得失敗';

    objectCount.textContent = '取得失敗';
    routeCount.textContent = '—';
    tolCount.textContent = '—';

    checks.innerHTML = '';

    checks.appendChild(
      card(
        {
          ...DEF.baseline,
          type: 'DATA UNAVAILABLE',
          title: '地図情報を取得できませんでした',
          limitation:
            'OpenStreetMap / Overpass APIから対象情報を取得できませんでした。取得失敗を「対象が存在しない」と解釈しないでください。'
        },
        '地図ベースの確認候補抽出を完了できませんでした。予定経路と離着陸地点の周辺を現地で確認してください。'
      )
    );

    setMode(
      null,
      '!',
      '地図データを取得できませんでした。時間をおいて再実行するか、現地確認を行ってください。'
    );
  } finally {
    analyzeBtn.disabled = false;
  }
});

updateWorkflow();
