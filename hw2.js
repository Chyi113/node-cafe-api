import express from 'express';
import fetch from 'node-fetch';
import bodyParser from 'body-parser';
import cors from 'cors';
import dotenv from 'dotenv';
import fs from 'fs';
import { CompactEncrypt, importSPKI } from 'jose';

const app = express();
app.use(bodyParser.json());
app.use(cors());
dotenv.config();

const API_KEY = process.env.GOOGLE_API_KEY;
console.log('API Key:', API_KEY);

// 讀入 public.pem
const publicKeyPem = fs.readFileSync('./public.pem', 'utf8');
const publicKey = await importSPKI(publicKeyPem, 'RSA-OAEP');

app.post('/api/nearby-cafes-open-3hr', async (req, res) => {
  const { latitude, longitude, currentTime } = req.body;

  let hasError = false;
  let response = {};

  if (!latitude) {
    response.latitude = 'There is an error in the input of latitude';
    hasError = true;
  } else {
    response.latitude = latitude;
  }

  if (!longitude) {
    response.longitude = 'There is an error in the input of longitude';
    hasError = true;
  } else {
    response.longitude = longitude;
  }

  if (!currentTime) {
    response.currentTime = 'There is an error in the input of currentTime';
    hasError = true;
  } else {
    response.currentTime = currentTime;
  }

  if (hasError) {
    return res.status(400).json(response);
  }

  let now;
  if (currentTime) {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    now = new Date(`${yyyy}-${mm}-${dd}T${currentTime}:00`);
  } else {
    now = new Date();
  }

  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  try {
    const nearbyUrl = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${latitude},${longitude}&radius=2000&type=establishment&keyword=咖啡&key=${API_KEY}&language=zh-TW`;
    const nearbyRes = await fetch(nearbyUrl);
    const nearbyData = await nearbyRes.json();

    if (!nearbyData.results || nearbyData.results.length === 0) {
      return res.status(200).json({
        code: 200,
        message: "Query executed successfully, but no data found.",
        data: []
      });
    }

    const cafes = nearbyData.results;
    const candidates = [];

    for (const cafe of cafes) {
      const detailUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${cafe.place_id}&fields=name,rating,formatted_address,opening_hours,geometry&language=zh-TW&key=${API_KEY}`;
      const detailRes = await fetch(detailUrl);
      const detailData = await detailRes.json();

      const place = detailData.result;
      const hours = place.opening_hours?.weekday_text;
      if (!hours) continue;

      const today = now.getDay();
      const todayIndex = (today + 6) % 7;
      const todayHours = hours[todayIndex];
      const match = todayHours.match(/: (.+) – (.+)/);
      if (!match) continue;

      const closingTimeStr = match[2];
      const [closingHour, closingMin] = closingTimeStr.split(':').map(Number);
      const closingMinutes = closingHour * 60 + closingMin;

      if (closingMinutes - currentMinutes >= 180) {
        const distKm = getDistanceInKm(
          latitude,
          longitude,
          place.geometry.location.lat,
          place.geometry.location.lng
        );

        candidates.push({
          name: place.name,
          address: place.formatted_address,
          rating: place.rating,
          distance_km: parseFloat(distKm.toFixed(2)),
          closing_time: closingTimeStr
        });
      }

      if (candidates.length >= 20) break;
    }

    const topThree = candidates.sort((a, b) => a.distance_km - b.distance_km).slice(0, 3);

    const payload = { data: topThree };
    const encoder = new TextEncoder();
    const payloadBytes = encoder.encode(JSON.stringify(payload));

    const jweString = await new CompactEncrypt(payloadBytes)
      .setProtectedHeader({ alg: 'RSA-OAEP', enc: 'A256GCM' })
      .encrypt(publicKey);

    const [protectedHeader, encrypted_key, iv, ciphertext, tag] = jweString.split('.');

    return res.status(200).json({
      protected: protectedHeader,
      encrypted_key,
      iv,
      ciphertext,
      tag
    });

  } catch (err) {
    console.error('❌ 錯誤:', err);
    return res.status(500).json({ error: '伺服器錯誤', detail: String(err) });
  }
});

function getDistanceInKm(lat1, lon1, lat2, lon2) {
  const R = 6371.0088;
  const x = deg2rad(lon2 - lon1) * Math.cos(deg2rad((lat1 + lat2) / 2));
  const y = deg2rad(lat2 - lat1);
  return Math.sqrt(x * x + y * y) * R;
}

function deg2rad(deg) {
  return deg * (Math.PI / 180);
}

app.listen(3001, '0.0.0.0', () => {
  console.log('✅ 加密版伺服器啟動於 http://localhost:3001');
});
