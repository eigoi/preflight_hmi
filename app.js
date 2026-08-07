const ANALYSIS_DISTANCE_KM = 0.2;

const map = L.map('map', { doubleClickZoom: false }).setView([37.4948, 139.9298], 14);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 20,
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

const routeGroup = L.layerGroup().addTo(map);
const areaGroup = L.layerGroup().addTo(map);
const utilityGroup = L.layerGroup().addTo(mapconst ANALYSIS_DISTANCE_KM = 0.2;

const map = L.map('map', { doubleClickZoom: false }).setView([37.4948, 139.9298], 14);
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
const manualTolBtn = $('manualTolBtn');
const undoBtn = $('undoBtn');
const resetBtn = $('resetBtn');
const drawRouteBtn = $('drawRouteBtn');
const coachTitle = $('coachTitle');
const coachBody = $('coachBody');
const tolChip = $('tolChip');
const routeChip = $('routeChip');
const analysisChip = $('analysisChip');
const analysisState = $('analysisState');
const checks = $('checks');
const template = $('checkTemplate');
const objectCount = $('objectCount');
const routeCount = $('routeCount');
const tolCount = $('tolCount');

let mode = null;
let routeLatLngs = [];
let routeLine = null;
let route = null;
let routeBuffer = null;
let tolMarker = null;
let tol = null;
let tolBuffer = null;
let currentCoords = null;
let analysisTimer = null;

const DEF = {
  route: {
    type: 'ROUTE-RELATED CHECK',
    title: '予定飛行経路周辺の架空線・電柱等を現地確認',
    action: '現地で、電線、通信線、支線等の有無、実際の位置、延伸方向、高さ、および予定飛行経路との関係を確認してください。',
    response: '必要な確認または十分な離隔を確保できない場合は、予定飛行経路または運航方法を再検討してください。',
    limitation: '利用可能な地図データには、すべての電線、通信線、支線、付属設備が登録されているとは限りません。',
    source: 'MLIT-M01 / M02 / M03 · SORA-informed S01 / S02'
  },
  tol: {
    type: 'TAKEOFF / LANDING CHECK',
    title: '離着陸地点の上空・周辺の線状障害物を現地確認',
    action: '離着陸地点の上空と周辺について、電線、通信線、支線等の実際の位置・高さ・方向、および離着陸時の機体移動方向との関係を確認してください。',
    response: '十分な周辺確認または必要な離隔を確保できない場合は、離着陸地点または運航計画を再検討してください。',
    limitation: '地図上に表示されない細い線状障害物や付属設備が存在する可能性があります。',
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

function setChip(el, text, state='pending') {
  el.textContent = text;
  el.className = `chip ${state}`;
}

function redrawRoute() {
  routeGroup.clearLayers();
  routeLatLngs.forEach(ll => {
    L.circleMarker(ll, {
      radius: 4.5, weight: 2, color: '#18587c',
      fillColor: '#fff', fillOpacity: 1
    }).addTo(routeGroup);
  });

  if (routeLatLngs.length >= 2) {
    routeLine = L.polyline(routeLatLngs, {
      color: '#18587c', weight: 4
    }).addTo(routeGroup);
  } else {
    routeLine = null;
  }

  undoBtn.disabled = routeLatLngs.length === 0;
}

function redrawAreas() {
  areaGroup.clearLayers();

  if (routeBuffer) {
    L.geoJSON(routeBuffer, {
      style: {
        color: '#587d91',
        weight: 2,
        fillColor: '#8ca9b8',
        fillOpacity: .18
      },
      interactive: false
    }).addTo(areaGroup);
  }

  if (tol) {
    tolBuffer = turf.buffer(tol, ANALYSIS_DISTANCE_KM, { units:'kilometers' });
    L.geoJSON(tolBuffer, {
      style: {
        color:'#666',
        weight:1.3,
        dashArray:'5 5',
        fillColor:'#999',
        fillOpacity:.07
      },
      interactive:false
    }).addTo(areaGroup);
  }
}

function setTolAt(latlng, popupText='離着陸地点') {
  if (tolMarker) map.removeLayer(tolMarker);

  tolMarker = L.marker(latlng, {
    draggable: true,
    title: 'Takeoff / Landing Point'
  }).addTo(map);

  tolMarker.bindPopup(
    `<strong>${popupText}</strong><br><small>ドラッグして位置を変更できます。</small>`
  );

  tol = turf.point([latlng.lng, latlng.lat]);
  redrawAreas();

  tolMarker.on('dragend', () => {
    const ll = tolMarker.getLatLng();
    tol = turf.point([ll.lng, ll.lat]);
    redrawAreas();
    setChip(tolChip, '離着陸地点：設定済み', 'done');
    scheduleAutoAnalysis();
  });

  setChip(tolChip, '離着陸地点：設定済み', 'done');
}

function requestLocation(auto=false) {
  if (!navigator.geolocation) return;

  locateBtn.disabled = true;
  locateBtn.textContent = '現在地取得中…';

  navigator.geolocation.getCurrentPosition(
    pos => {
      const { latitude, longitude, accuracy } = pos.coords;
      currentCoords = { latitude, longitude, accuracy };
      const ll = L.latLng(latitude, longitude);

      locationGroup.clearLayers();

      L.circle(ll, {
        radius: accuracy,
        color:'#2478c5',
        weight:1.3,
        fillColor:'#5da8df',
        fillOpacity:.10
      }).addTo(locationGroup);

      L.circleMarker(ll, {
        radius:7,
        color:'#fff',
        weight:3,
        fillColor:'#2478c5',
        fillOpacity:1
      }).addTo(locationGroup)
        .bindTooltip(`現在地（精度 約${Math.round(accuracy)} m）`);

      map.setView(ll, 17);

      // 初回だけ、離着陸地点がまだなければ現在地を初期値として使う。
      if (!tol) {
        setTolAt(ll, '離着陸地点（現在地を初期値として設定）');
      }

      locateBtn.textContent = '◎ 現在地';
      locateBtn.disabled = false;

      if (auto) {
        coachTitle.textContent = '現在地を離着陸地点の初期値にしました';
        coachBody.textContent = '違う場所から離着陸する場合は、黒いマーカーをドラッグして移動できます。';
      }
    },
    () => {
      locateBtn.textContent = '◎ 現在地';
      locateBtn.disabled = false;
      if (auto) {
        coachTitle.textContent = '経路を描いてください';
        coachBody.textContent = '現在地は取得できませんでした。離着陸地点はあとから地図上で設定できます。';
      }
    },
    { enableHighAccuracy:true, timeout:9000, maximumAge:30000 }
  );
}

locateBtn.addEventListener('click', () => requestLocation(false));

manualTolBtn.addEventListener('click', () => {
  mode = 'tol';
  coachTitle.textContent = '離着陸地点を変更';
  coachBody.textContent = '地図上で新しい離着陸地点を1回クリックしてください。';
});

drawRouteBtn.addEventListener('click', () => {
  if (mode !== 'route') {
    routeLatLngs = [];
    route = null;
    routeBuffer = null;
    routeGroup.clearLayers();
    areaGroup.clearLayers();
    redrawAreas();
    utilityGroup.clearLayers();

    mode = 'route';
    drawRouteBtn.textContent = '経路を確定して分析';
    drawRouteBtn.classList.add('finish');
    coachTitle.textContent = '地図上を順番にクリック';
    coachBody.textContent = '通過点を追加してください。2点以上入力すると、このボタンでそのまま分析できます。';
    setChip(routeChip, '経路：入力中', 'loading');
    setChip(analysisChip, '未分析', 'pending');
    return;
  }

  finishRouteAndAnalyze();
});

undoBtn.addEventListener('click', () => {
  if (!routeLatLngs.length) return;
  routeLatLngs.pop();
  redrawRoute();

  if (routeLatLngs.length === 0) {
    setChip(routeChip, '経路：入力中', 'loading');
  }
});

resetBtn.addEventListener('click', () => {
  routeLatLngs = [];
  route = null;
  routeBuffer = null;
  routeLine = null;
  routeGroup.clearLayers();
  areaGroup.clearLayers();
  utilityGroup.clearLayers();

  if (tolMarker) map.removeLayer(tolMarker);
  tolMarker = null;
  tol = null;
  tolBuffer = null;

  mode = null;
  setChip(tolChip, '離着陸地点：未設定', 'pending');
  setChip(routeChip, '経路：未設定', 'pending');
  setChip(analysisChip, '未分析', 'pending');
  analysisState.textContent = '待機中';
  analysisState.className = 'state-badge';
  objectCount.textContent = routeCount.textContent = tolCount.textContent = '—';
  drawRouteBtn.textContent = '経路を描く';
  drawRouteBtn.classList.remove('finish');
  undoBtn.disabled = true;
  coachTitle.textContent = 'まず経路を描きます';
  coachBody.textContent = 'ボタンを押したら、地図上の通過点を順番にクリックしてください。';
  checks.innerHTML = '<div class="empty-state">経路を描き終えると、自動で分析結果がここに表示されます。</div>';
});

map.on('click', e => {
  if (mode === 'route') {
    routeLatLngs.push(e.latlng);
    redrawRoute();

    if (routeLatLngs.length >= 2) {
      coachTitle.textContent = `${routeLatLngs.length}点入力済み`;
      coachBody.textContent = 'さらに通過点を追加するか、「経路を確定して分析」を押してください。';
    }
    return;
  }

  if (mode === 'tol') {
    setTolAt(e.latlng);
    mode = null;
    coachTitle.textContent = '離着陸地点を変更しました';
    coachBody.textContent = '黒いマーカーはドラッグでも位置を変更できます。経路設定済みなら自動で再分析します。';
    scheduleAutoAnalysis();
  }
});

map.on('dblclick', e => {
  if (mode === 'route' && routeLatLngs.length >= 2) {
    L.DomEvent.stop(e);
    // double click の2回目の click で同じ地点が追加される場合があるため近接点を整理
    if (routeLatLngs.length >= 2) {
      const a = routeLatLngs[routeLatLngs.length - 1];
      const b = routeLatLngs[routeLatLngs.length - 2];
      if (a.distanceTo(b) < 2) routeLatLngs.pop();
    }
    redrawRoute();
    finishRouteAndAnalyze();
  }
});

async function finishRouteAndAnalyze() {
  if (routeLatLngs.length < 2) {
    coachTitle.textContent = '経路には2点以上必要です';
    coachBody.textContent = '地図上でもう1点以上クリックしてください。';
    return;
  }

  route = turf.lineString(routeLatLngs.map(ll => [ll.lng, ll.lat]));
  routeBuffer = turf.buffer(route, ANALYSIS_DISTANCE_KM, { units:'kilometers' });
  redrawAreas();

  setChip(routeChip, `経路：${routeLatLngs.length}点`, 'done');
  mode = null;
  drawRouteBtn.textContent = '経路を描き直す';
  drawRouteBtn.classList.remove('finish');

  // 離着陸地点がない場合は経路始点を仮の初期値にする。
  if (!tol) {
    setTolAt(routeLatLngs[0], '離着陸地点（経路始点を初期値として設定）');
  }

  coachTitle.textContent = '入力完了';
  coachBody.textContent = '周辺地図情報を自動で分析しています。';
  await analyze();
}

function scheduleAutoAnalysis() {
  if (!(route && tol)) return;
  clearTimeout(analysisTimer);
  analysisTimer = setTimeout(() => analyze(), 450);
}

function queryFor(bbox) {
  const [w,s,e,n] = bbox;
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
        method:'POST',
        headers:{'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8'},
        body:'data=' + encodeURIComponent(query)
      });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return await response.json();
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

function intersects(feature, polygon) {
  try { return !!(feature && feature.geometry && polygon && turf.booleanIntersects(feature, polygon)); }
  catch { return false; }
}

function label(feature) {
  const p = feature.properties || {};
  if (p.power === 'pole') return '電柱';
  if (p.power === 'tower') return '鉄塔';
  if (p.power === 'line') return '送電線';
  if (p.power === 'minor_line') return '配電線';
  if (p.man_made === 'utility_pole') return '電柱';
  return '電線・電柱';
}

function distanceToRoute(feature) {
  try {
    let min = Infinity;
    turf.flattenEach(feature, part => {
      const g = part.geometry;
      if (!g) return;
      if (g.type === 'Point') {
        min = Math.min(min, turf.pointToLineDistance(part, route, {units:'kilometers'}));
      } else if (g.type === 'LineString') {
        g.coordinates.forEach(c => {
          min = Math.min(min, turf.pointToLineDistance(turf.point(c), route, {units:'kilometers'}));
        });
      }
    });
    return Number.isFinite(min) ? min : null;
  } catch { return null; }
}

function renderUtility(features) {
  utilityGroup.clearLayers();
  features.forEach(feature => {
    const distance = distanceToRoute(feature);
    const d = distance == null ? '距離取得不可' : `予定経路から約${Math.round(distance*1000)} m`;
    L.geoJSON(feature, {
      pointToLayer:(_,ll)=>L.circleMarker(ll,{radius:6,color:'#8f3828',fillColor:'#b24830',fillOpacity:.9,weight:2}),
      style:{color:'#b24830',weight:4,opacity:.9},
      onEachFeature:(_,layer)=>layer.bindPopup(`<strong>${label(feature)}</strong><br>${d}<br><small>実物は現地で確認してください。</small>`)
    }).addTo(utilityGroup);
  });
}

function card(def, context) {
  const node = template.content.cloneNode(true);
  node.querySelector('.check-type').textContent = def.type;
  node.querySelector('.check-title').textContent = def.title;
  node.querySelector('.check-context').textContent = context;
  node.querySelector('.check-action').textContent = def.action;
  node.querySelector('.check-response').textContent = def.response;
  node.querySelector('.check-limitation').textContent = def.limitation;
  node.querySelector('.check-source').textContent = def.source;
  return node;
}

function renderChecks(routeFeatures, tolFeatures, all) {
  checks.innerHTML = '';

  if (routeFeatures.length) {
    const ds = routeFeatures.map(distanceToRoute).filter(d=>d!=null);
    const closest = ds.length ? Math.round(Math.min(...ds)*1000) : null;
    const context = `${routeFeatures.length}件の電線・電柱の地図情報が予定飛行経路から200 m以内で確認されました。` +
      (closest == null ? '' : ` 最も近いものは経路から約${closest} mです。`);
    checks.appendChild(card(DEF.route, context));
  }

  if (tolFeatures.length) {
    checks.appendChild(card(
      DEF.tol,
      `${tolFeatures.length}件の電線・電柱の地図情報が離着陸地点から200 m以内で確認されました。`
    ));
  }

  if (!all.length) {
    checks.appendChild(card(
      DEF.baseline,
      '利用可能なOpenStreetMapデータでは、今回の分析範囲内に対象タグの電線・電柱は確認されませんでした。'
    ));
  }
}

async function analyze() {
  if (!(route && routeBuffer && tol)) return;

  tolBuffer = turf.buffer(tol, ANALYSIS_DISTANCE_KM, { units:'kilometers' });
  redrawAreas();

  setChip(analysisChip, '分析中', 'loading');
  analysisState.textContent = '分析中';
  analysisState.className = 'state-badge loading';
  checks.innerHTML = '<div class="empty-state">周辺地図情報を取得しています…</div>';

  try {
    const bbox = turf.bbox(turf.featureCollection([routeBuffer, tolBuffer]));
    const osm = await fetchOverpass(queryFor(bbox));
    const geojson = osmtogeojson(osm);

    const all = (geojson.features || []).filter(
      f => intersects(f, routeBuffer) || intersects(f, tolBuffer)
    );
    const routeFeatures = all.filter(f => intersects(f, routeBuffer));
    const tolFeatures = all.filter(f => intersects(f, tolBuffer));

    renderUtility(all);
    renderChecks(routeFeatures, tolFeatures, all);

    objectCount.textContent = all.length;
    routeCount.textContent = routeFeatures.length;
    tolCount.textContent = tolFeatures.length;

    setChip(analysisChip, '分析完了', 'done');
    analysisState.textContent = '分析完了';
    analysisState.className = 'state-badge done';

    coachTitle.textContent = '分析完了';
    coachBody.textContent = '右側に表示された項目を、実際の飛行場所で確認してください。';
  } catch (err) {
    console.error(err);
    utilityGroup.clearLayers();

    setChip(analysisChip, '取得失敗', 'error');
    analysisState.textContent = '取得失敗';
    analysisState.className = 'state-badge error';
    objectCount.textContent = '取得失敗';
    routeCount.textContent = tolCount.textContent = '—';

    checks.innerHTML = '';
    checks.appendChild(card(
      {
        ...DEF.baseline,
        type:'DATA UNAVAILABLE',
        title:'地図情報を取得できませんでした',
        limitation:'地図情報の取得失敗を「対象が存在しない」と解釈しないでください。'
      },
      '地図ベースの確認候補抽出を完了できませんでした。予定経路と離着陸地点の周辺を現地で確認してください。'
    ));

    coachTitle.textContent = '地図情報を取得できませんでした';
    coachBody.textContent = '時間をおいて再度経路を確定するか、現地確認を行ってください。';
  }
}

// ページ読み込み後に現在地を自動取得。拒否されてもシステムはそのまま利用可能。
window.addEventListener('load', () => {
  setTimeout(() => requestLocation(true), 350);
});
);
const locationGroup = L.layerGroup().addTo(map);

const $ = id => document.getElementById(id);
const locateBtn = $('locateBtn');
const manualTolBtn = $('manualTolBtn');
const undoBtn = $('undoBtn');
const resetBtn = $('resetBtn');
const drawRouteBtn = $('drawRouteBtn');
const coachTitle = $('coachTitle');
const coachBody = $('coachBody');
const tolChip = $('tolChip');
const routeChip = $('routeChip');
const analysisChip = $('analysisChip');
const analysisState = $('analysisState');
const checks = $('checks');
const template = $('checkTemplate');
const objectCount = $('objectCount');
const routeCount = $('routeCount');
const tolCount = $('tolCount');

let mode = null;
let routeLatLngs = [];
let routeLine = null;
let route = null;
let routeBuffer = null;
let tolMarker = null;
let tol = null;
let tolBuffer = null;
let currentCoords = null;
let analysisTimer = null;

const DEF = {
  route: {
    type: 'ROUTE-RELATED CHECK',
    title: '予定飛行経路周辺の架空線・電柱等を現地確認',
    action: '現地で、電線、通信線、支線等の有無、実際の位置、延伸方向、高さ、および予定飛行経路との関係を確認してください。',
    response: '必要な確認または十分な離隔を確保できない場合は、予定飛行経路または運航方法を再検討してください。',
    limitation: '利用可能な地図データには、すべての電線、通信線、支線、付属設備が登録されているとは限りません。',
    source: 'MLIT-M01 / M02 / M03 · SORA-informed S01 / S02'
  },
  tol: {
    type: 'TAKEOFF / LANDING CHECK',
    title: '離着陸地点の上空・周辺の線状障害物を現地確認',
    action: '離着陸地点の上空と周辺について、電線、通信線、支線等の実際の位置・高さ・方向、および離着陸時の機体移動方向との関係を確認してください。',
    response: '十分な周辺確認または必要な離隔を確保できない場合は、離着陸地点または運航計画を再検討してください。',
    limitation: '地図上に表示されない細い線状障害物や付属設備が存在する可能性があります。',
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

function setChip(el, text, state='pending') {
  el.textContent = text;
  el.className = `chip ${state}`;
}

function redrawRoute() {
  routeGroup.clearLayers();
  routeLatLngs.forEach(ll => {
    L.circleMarker(ll, {
      radius: 4.5, weight: 2, color: '#18587c',
      fillColor: '#fff', fillOpacity: 1
    }).addTo(routeGroup);
  });

  if (routeLatLngs.length >= 2) {
    routeLine = L.polyline(routeLatLngs, {
      color: '#18587c', weight: 4
    }).addTo(routeGroup);
  } else {
    routeLine = null;
  }

  undoBtn.disabled = routeLatLngs.length === 0;
}

function redrawAreas() {
  areaGroup.clearLayers();

  if (routeBuffer) {
    L.geoJSON(routeBuffer, {
      style: {
        color: '#587d91',
        weight: 2,
        fillColor: '#8ca9b8',
        fillOpacity: .18
      },
      interactive: false
    }).addTo(areaGroup);
  }

  if (tol) {
    tolBuffer = turf.buffer(tol, ANALYSIS_DISTANCE_KM, { units:'kilometers' });
    L.geoJSON(tolBuffer, {
      style: {
        color:'#666',
        weight:1.3,
        dashArray:'5 5',
        fillColor:'#999',
        fillOpacity:.07
      },
      interactive:false
    }).addTo(areaGroup);
  }
}

function setTolAt(latlng, popupText='離着陸地点') {
  if (tolMarker) map.removeLayer(tolMarker);

  tolMarker = L.marker(latlng, {
    draggable: true,
    title: 'Takeoff / Landing Point'
  }).addTo(map);

  tolMarker.bindPopup(
    `<strong>${popupText}</strong><br><small>ドラッグして位置を変更できます。</small>`
  );

  tol = turf.point([latlng.lng, latlng.lat]);
  redrawAreas();

  tolMarker.on('dragend', () => {
    const ll = tolMarker.getLatLng();
    tol = turf.point([ll.lng, ll.lat]);
    redrawAreas();
    setChip(tolChip, '離着陸地点：設定済み', 'done');
    scheduleAutoAnalysis();
  });

  setChip(tolChip, '離着陸地点：設定済み', 'done');
}

function requestLocation(auto=false) {
  if (!navigator.geolocation) return;

  locateBtn.disabled = true;
  locateBtn.textContent = '現在地取得中…';

  navigator.geolocation.getCurrentPosition(
    pos => {
      const { latitude, longitude, accuracy } = pos.coords;
      currentCoords = { latitude, longitude, accuracy };
      const ll = L.latLng(latitude, longitude);

      locationGroup.clearLayers();

      L.circle(ll, {
        radius: accuracy,
        color:'#2478c5',
        weight:1.3,
        fillColor:'#5da8df',
        fillOpacity:.10
      }).addTo(locationGroup);

      L.circleMarker(ll, {
        radius:7,
        color:'#fff',
        weight:3,
        fillColor:'#2478c5',
        fillOpacity:1
      }).addTo(locationGroup)
        .bindTooltip(`現在地（精度 約${Math.round(accuracy)} m）`);

      map.setView(ll, 17);

      // 初回だけ、離着陸地点がまだなければ現在地を初期値として使う。
      if (!tol) {
        setTolAt(ll, '離着陸地点（現在地を初期値として設定）');
      }

      locateBtn.textContent = '◎ 現在地';
      locateBtn.disabled = false;

      if (auto) {
        coachTitle.textContent = '現在地を離着陸地点の初期値にしました';
        coachBody.textContent = '違う場所から離着陸する場合は、黒いマーカーをドラッグして移動できます。';
      }
    },
    () => {
      locateBtn.textContent = '◎ 現在地';
      locateBtn.disabled = false;
      if (auto) {
        coachTitle.textContent = '経路を描いてください';
        coachBody.textContent = '現在地は取得できませんでした。離着陸地点はあとから地図上で設定できます。';
      }
    },
    { enableHighAccuracy:true, timeout:9000, maximumAge:30000 }
  );
}

locateBtn.addEventListener('click', () => requestLocation(false));

manualTolBtn.addEventListener('click', () => {
  mode = 'tol';
  coachTitle.textContent = '離着陸地点を変更';
  coachBody.textContent = '地図上で新しい離着陸地点を1回クリックしてください。';
});

drawRouteBtn.addEventListener('click', () => {
  if (mode !== 'route') {
    routeLatLngs = [];
    route = null;
    routeBuffer = null;
    routeGroup.clearLayers();
    areaGroup.clearLayers();
    redrawAreas();
    utilityGroup.clearLayers();

    mode = 'route';
    drawRouteBtn.textContent = '経路を確定して分析';
    drawRouteBtn.classList.add('finish');
    coachTitle.textContent = '地図上を順番にクリック';
    coachBody.textContent = '通過点を追加してください。2点以上入力すると、このボタンでそのまま分析できます。';
    setChip(routeChip, '経路：入力中', 'loading');
    setChip(analysisChip, '未分析', 'pending');
    return;
  }

  finishRouteAndAnalyze();
});

undoBtn.addEventListener('click', () => {
  if (!routeLatLngs.length) return;
  routeLatLngs.pop();
  redrawRoute();

  if (routeLatLngs.length === 0) {
    setChip(routeChip, '経路：入力中', 'loading');
  }
});

resetBtn.addEventListener('click', () => {
  routeLatLngs = [];
  route = null;
  routeBuffer = null;
  routeLine = null;
  routeGroup.clearLayers();
  areaGroup.clearLayers();
  utilityGroup.clearLayers();

  if (tolMarker) map.removeLayer(tolMarker);
  tolMarker = null;
  tol = null;
  tolBuffer = null;

  mode = null;
  setChip(tolChip, '離着陸地点：未設定', 'pending');
  setChip(routeChip, '経路：未設定', 'pending');
  setChip(analysisChip, '未分析', 'pending');
  analysisState.textContent = '待機中';
  analysisState.className = 'state-badge';
  objectCount.textContent = routeCount.textContent = tolCount.textContent = '—';
  drawRouteBtn.textContent = '経路を描く';
  drawRouteBtn.classList.remove('finish');
  undoBtn.disabled = true;
  coachTitle.textContent = 'まず経路を描きます';
  coachBody.textContent = 'ボタンを押したら、地図上の通過点を順番にクリックしてください。';
  checks.innerHTML = '<div class="empty-state">経路を描き終えると、自動で分析結果がここに表示されます。</div>';
});

map.on('click', e => {
  if (mode === 'route') {
    routeLatLngs.push(e.latlng);
    redrawRoute();

    if (routeLatLngs.length >= 2) {
      coachTitle.textContent = `${routeLatLngs.length}点入力済み`;
      coachBody.textContent = 'さらに通過点を追加するか、「経路を確定して分析」を押してください。';
    }
    return;
  }

  if (mode === 'tol') {
    setTolAt(e.latlng);
    mode = null;
    coachTitle.textContent = '離着陸地点を変更しました';
    coachBody.textContent = '黒いマーカーはドラッグでも位置を変更できます。経路設定済みなら自動で再分析します。';
    scheduleAutoAnalysis();
  }
});

map.on('dblclick', e => {
  if (mode === 'route' && routeLatLngs.length >= 2) {
    L.DomEvent.stop(e);
    // double click の2回目の click で同じ地点が追加される場合があるため近接点を整理
    if (routeLatLngs.length >= 2) {
      const a = routeLatLngs[routeLatLngs.length - 1];
      const b = routeLatLngs[routeLatLngs.length - 2];
      if (a.distanceTo(b) < 2) routeLatLngs.pop();
    }
    redrawRoute();
    finishRouteAndAnalyze();
  }
});

async function finishRouteAndAnalyze() {
  if (routeLatLngs.length < 2) {
    coachTitle.textContent = '経路には2点以上必要です';
    coachBody.textContent = '地図上でもう1点以上クリックしてください。';
    return;
  }

  route = turf.lineString(routeLatLngs.map(ll => [ll.lng, ll.lat]));
  routeBuffer = turf.buffer(route, ANALYSIS_DISTANCE_KM, { units:'kilometers' });
  redrawAreas();

  setChip(routeChip, `経路：${routeLatLngs.length}点`, 'done');
  mode = null;
  drawRouteBtn.textContent = '経路を描き直す';
  drawRouteBtn.classList.remove('finish');

  // 離着陸地点がない場合は経路始点を仮の初期値にする。
  if (!tol) {
    setTolAt(routeLatLngs[0], '離着陸地点（経路始点を初期値として設定）');
  }

  coachTitle.textContent = '入力完了';
  coachBody.textContent = '周辺地図情報を自動で分析しています。';
  await analyze();
}

function scheduleAutoAnalysis() {
  if (!(route && tol)) return;
  clearTimeout(analysisTimer);
  analysisTimer = setTimeout(() => analyze(), 450);
}

function queryFor(bbox) {
  const [w,s,e,n] = bbox;
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
        method:'POST',
        headers:{'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8'},
        body:'data=' + encodeURIComponent(query)
      });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return await response.json();
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

function intersects(feature, polygon) {
  try { return !!(feature && feature.geometry && polygon && turf.booleanIntersects(feature, polygon)); }
  catch { return false; }
}

function label(feature) {
  const p = feature.properties || {};
  if (p.power === 'pole') return '電柱';
  if (p.power === 'tower') return '鉄塔';
  if (p.power === 'line') return '送電線';
  if (p.power === 'minor_line') return '配電線';
  if (p.man_made === 'utility_pole') return '電柱';
  return '電線・電柱';
}

function distanceToRoute(feature) {
  try {
    let min = Infinity;
    turf.flattenEach(feature, part => {
      const g = part.geometry;
      if (!g) return;
      if (g.type === 'Point') {
        min = Math.min(min, turf.pointToLineDistance(part, route, {units:'kilometers'}));
      } else if (g.type === 'LineString') {
        g.coordinates.forEach(c => {
          min = Math.min(min, turf.pointToLineDistance(turf.point(c), route, {units:'kilometers'}));
        });
      }
    });
    return Number.isFinite(min) ? min : null;
  } catch { return null; }
}

function renderUtility(features) {
  utilityGroup.clearLayers();
  features.forEach(feature => {
    const distance = distanceToRoute(feature);
    const d = distance == null ? '距離取得不可' : `予定経路から約${Math.round(distance*1000)} m`;
    L.geoJSON(feature, {
      pointToLayer:(_,ll)=>L.circleMarker(ll,{radius:6,color:'#8f3828',fillColor:'#b24830',fillOpacity:.9,weight:2}),
      style:{color:'#b24830',weight:4,opacity:.9},
      onEachFeature:(_,layer)=>layer.bindPopup(`<strong>${label(feature)}</strong><br>${d}<br><small>実物は現地で確認してください。</small>`)
    }).addTo(utilityGroup);
  });
}

function card(def, context) {
  const node = template.content.cloneNode(true);
  node.querySelector('.check-type').textContent = def.type;
  node.querySelector('.check-title').textContent = def.title;
  node.querySelector('.check-context').textContent = context;
  node.querySelector('.check-action').textContent = def.action;
  node.querySelector('.check-response').textContent = def.response;
  node.querySelector('.check-limitation').textContent = def.limitation;
  node.querySelector('.check-source').textContent = def.source;
  return node;
}

function renderChecks(routeFeatures, tolFeatures, all) {
  checks.innerHTML = '';

  if (routeFeatures.length) {
    const ds = routeFeatures.map(distanceToRoute).filter(d=>d!=null);
    const closest = ds.length ? Math.round(Math.min(...ds)*1000) : null;
    const context = `${routeFeatures.length}件の電線・電柱の地図情報が予定飛行経路から200 m以内で確認されました。` +
      (closest == null ? '' : ` 最も近いものは経路から約${closest} mです。`);
    checks.appendChild(card(DEF.route, context));
  }

  if (tolFeatures.length) {
    checks.appendChild(card(
      DEF.tol,
      `${tolFeatures.length}件の電線・電柱の地図情報が離着陸地点から200 m以内で確認されました。`
    ));
  }

  if (!all.length) {
    checks.appendChild(card(
      DEF.baseline,
      '利用可能なOpenStreetMapデータでは、今回の分析範囲内に対象タグの電線・電柱は確認されませんでした。'
    ));
  }
}

async function analyze() {
  if (!(route && routeBuffer && tol)) return;

  tolBuffer = turf.buffer(tol, ANALYSIS_DISTANCE_KM, { units:'kilometers' });
  redrawAreas();

  setChip(analysisChip, '分析中', 'loading');
  analysisState.textContent = '分析中';
  analysisState.className = 'state-badge loading';
  checks.innerHTML = '<div class="empty-state">周辺地図情報を取得しています…</div>';

  try {
    const bbox = turf.bbox(turf.featureCollection([routeBuffer, tolBuffer]));
    const osm = await fetchOverpass(queryFor(bbox));
    const geojson = osmtogeojson(osm);

    const all = (geojson.features || []).filter(
      f => intersects(f, routeBuffer) || intersects(f, tolBuffer)
    );
    const routeFeatures = all.filter(f => intersects(f, routeBuffer));
    const tolFeatures = all.filter(f => intersects(f, tolBuffer));

    renderUtility(all);
    renderChecks(routeFeatures, tolFeatures, all);

    objectCount.textContent = all.length;
    routeCount.textContent = routeFeatures.length;
    tolCount.textContent = tolFeatures.length;

    setChip(analysisChip, '分析完了', 'done');
    analysisState.textContent = '分析完了';
    analysisState.className = 'state-badge done';

    coachTitle.textContent = '分析完了';
    coachBody.textContent = '右側に表示された項目を、実際の飛行場所で確認してください。';
  } catch (err) {
    console.error(err);
    utilityGroup.clearLayers();

    setChip(analysisChip, '取得失敗', 'error');
    analysisState.textContent = '取得失敗';
    analysisState.className = 'state-badge error';
    objectCount.textContent = '取得失敗';
    routeCount.textContent = tolCount.textContent = '—';

    checks.innerHTML = '';
    checks.appendChild(card(
      {
        ...DEF.baseline,
        type:'DATA UNAVAILABLE',
        title:'地図情報を取得できませんでした',
        limitation:'地図情報の取得失敗を「対象が存在しない」と解釈しないでください。'
      },
      '地図ベースの確認候補抽出を完了できませんでした。予定経路と離着陸地点の周辺を現地で確認してください。'
    ));

    coachTitle.textContent = '地図情報を取得できませんでした';
    coachBody.textContent = '時間をおいて再度経路を確定するか、現地確認を行ってください。';
  }
}

// ページ読み込み後に現在地を自動取得。拒否されてもシステムはそのまま利用可能。
window.addEventListener('load', () => {
  setTimeout(() => requestLocation(true), 350);
});
