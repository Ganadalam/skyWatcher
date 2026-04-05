import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";
dotenv.config();

const app = express();

// CORS — express.json보다 반드시 먼저
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.use(express.json());

const ORS_KEY = process.env.ORS_KEY;
const WEATHER_KEY = process.env.WEATHER_KEY;
const TOUR_KEY = process.env.TOUR_KEY;

const ORS_BASE = "https://api.openrouteservice.org/v2/directions";
const WEATHER_BASE = "https://api.openweathermap.org/data/2.5";
const TOUR_BASE = "https://apis.data.go.kr/B551011/KorService2";

// 1) 경로 프록시 (ORS)
app.post("/route", async (req, res) => {
  try {
    const { coordinates, profile = "driving" } = req.body;
    if (!coordinates || coordinates.length < 2)
      return res
        .status(400)
        .json({ error: "coordinates must have >= 2 points" });
    const hasInvalid = coordinates.some(
      ([lng, lat]) =>
        !lng || !lat || Math.abs(lng) < 0.001 || Math.abs(lat) < 0.001,
    );
    if (hasInvalid)
      return res.status(400).json({ error: "invalid coordinate(s)" });
    const orsProfile = profile === "walking" ? "foot-walking" : "driving-car";
    const url = `${ORS_BASE}/${orsProfile}/geojson`;
    const orsRes = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ORS_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ coordinates, instructions: false, units: "km" }),
    });
    const data = await orsRes.json();
    if (!orsRes.ok) {
      console.error(`ORS [${orsProfile}] 오류:`, data);
      return res
        .status(orsRes.status)
        .json({ error: data?.error?.message ?? "ORS 오류" });
    }
    const feature = data?.features?.[0];
    const duration_sec = feature?.properties?.summary?.duration;
    const coords = feature?.geometry?.coordinates ?? [];
    const geometry = coords.map(([lng, lat]) => [lat, lng]);
    res.json({
      duration_min: duration_sec
        ? Math.max(1, Math.ceil(duration_sec / 60))
        : null,
      geometry,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2) 날씨 - 좌표
app.get("/api/weather/coords", async (req, res) => {
  try {
    const { lat, lon } = req.query;
    const r = await fetch(
      `${WEATHER_BASE}/weather?lat=${lat}&lon=${lon}&appid=${WEATHER_KEY}&units=metric&lang=en`,
    );
    res.status(r.status).json(await r.json());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3) 날씨 - 도시명
app.get("/api/weather/city", async (req, res) => {
  try {
    const { q } = req.query;
    const r = await fetch(
      `${WEATHER_BASE}/weather?q=${encodeURIComponent(q)}&appid=${WEATHER_KEY}&units=metric&lang=en`,
    );
    res.status(r.status).json(await r.json());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4) 날씨 예보 - 좌표
app.get("/api/weather/forecast", async (req, res) => {
  try {
    const { lat, lon } = req.query;
    const r = await fetch(
      `${WEATHER_BASE}/forecast?lat=${lat}&lon=${lon}&appid=${WEATHER_KEY}&units=metric&lang=en`,
    );
    res.status(r.status).json(await r.json());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5) TourAPI - 위치기반
app.get("/api/tour/location", async (req, res) => {
  try {
    const { mapX, mapY, radius, contentTypeId, arrange = "E" } = req.query;
    let qs = `serviceKey=${TOUR_KEY}&MobileOS=ETC&MobileApp=SKYWATCHER&_type=json&numOfRows=40&pageNo=1`;
    qs += `&mapX=${mapX}&mapY=${mapY}&radius=${radius}&arrange=${arrange}`;
    if (contentTypeId) qs += `&contentTypeId=${contentTypeId}`;
    const r = await fetch(`${TOUR_BASE}/locationBasedList2?${qs}`);
    res.status(r.status).json(await r.json());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6) TourAPI - 키워드 검색
app.get("/api/tour/keyword", async (req, res) => {
  try {
    const { keyword, contentTypeId, arrange = "A" } = req.query;
    let qs = `serviceKey=${TOUR_KEY}&MobileOS=ETC&MobileApp=SKYWATCHER&_type=json&numOfRows=40&pageNo=1`;
    qs += `&keyword=${encodeURIComponent(keyword)}&arrange=${arrange}`;
    if (contentTypeId) qs += `&contentTypeId=${contentTypeId}`;
    const r = await fetch(`${TOUR_BASE}/searchKeyword2?${qs}`);
    res.status(r.status).json(await r.json());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 7) 핑
app.get("/ping", (_, res) => res.json({ ok: true }));

// 8) TourAPI - 상세 개요
app.get("/api/tour/detail", async (req, res) => {
  try {
    const { contentId } = req.query;
    const qs = `serviceKey=${TOUR_KEY}&MobileOS=ETC&MobileApp=SKYWATCHER&_type=json&contentId=${contentId}&overviewYN=Y`;
    const r = await fetch(`${TOUR_BASE}/detailCommon2?${qs}`);
    res.status(r.status).json(await r.json());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 9) TourAPI - 현재 진행 행사 검색 (eventstartdate 이전~오늘 이후 종료)
app.get("/api/tour/festival", async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0,10).replace(/-/g,"");
    const { mapX, mapY } = req.query;
    let qs = `serviceKey=${TOUR_KEY}&MobileOS=ETC&MobileApp=SKYWATCHER&_type=json&numOfRows=40&pageNo=1`;
    qs += `&eventStartDate=${today}&arrange=A`;
    if (mapX && mapY) qs += `&mapX=${mapX}&mapY=${mapY}`;
    const r = await fetch(`${TOUR_BASE}/searchFestival2?${qs}`);
    res.status(r.status).json(await r.json());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 10) TourAPI - 운영시간/휴일 (detailIntro)
app.get("/api/tour/intro", async (req, res) => {
  try {
    const { contentId, contentTypeId } = req.query;
    const qs = `serviceKey=${TOUR_KEY}&MobileOS=ETC&MobileApp=SKYWATCHER&_type=json&contentId=${contentId}&contentTypeId=${contentTypeId || 12}&introYN=Y`;
    const r = await fetch(`${TOUR_BASE}/detailIntro2?${qs}`);
    res.status(r.status).json(await r.json());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`SKYWATCHER proxy on :${PORT}`));
