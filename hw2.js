import express from 'express'
import fetch from 'node-fetch'
import bodyParser from 'body-parser'
import cors from 'cors'
import dotenv from 'dotenv'

const app = express()
app.use(bodyParser.json())
app.use(cors())
dotenv.config()

const API_KEY = process.env.GOOGLE_API_KEY
const DECRYPT_API = 'https://decrypt-api-gait.onrender.com/api/decrypt'

app.post('/api/nearby-cafes-open-3hr', async (req, res) => {
  try {
    // ✅ 解密前端送來的加密 payload
    const decryptRes = await fetch(DECRYPT_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body)
    })

    if (!decryptRes.ok) {
      const err = await decryptRes.json()
      return res.status(400).json({ error: 'JWE 解密失敗', detail: err })
    }

    const { latitude, longitude, currentTime } = await decryptRes.json()

    // ✅ 以下邏輯與原本 hw2.js 相同
    if (!latitude || !longitude || !currentTime) {
      return res.status(400).json({
        latitude: latitude ? latitude : '缺少 latitude',
        longitude: longitude ? longitude : '缺少 longitude',
        currentTime: currentTime ? currentTime : '缺少 currentTime'
      })
    }

    const today = new Date()
    const yyyy = today.getFullYear()
    const mm = String(today.getMonth() + 1).padStart(2, '0')
    const dd = String(today.getDate()).padStart(2, '0')
    const now = new Date(`${yyyy}-${mm}-${dd}T${currentTime}:00`)
    const currentMinutes = now.getHours() * 60 + now.getMinutes()

    const nearbyUrl = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${latitude},${longitude}&radius=2000&type=establishment&keyword=咖啡&key=${API_KEY}&language=zh-TW`
    const nearbyRes = await fetch(nearbyUrl)
    const nearbyData = await nearbyRes.json()

    if (!nearbyData.results || nearbyData.results.length === 0) {
      return res.status(200).json({ code: 200, message: "查詢成功但無資料", data: [] })
    }

    const cafes = nearbyData.results
    const candidates = []

    for (const cafe of cafes) {
      const detailUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${cafe.place_id}&fields=name,rating,formatted_address,opening_hours,geometry&language=zh-TW&key=${API_KEY}`
      const detailRes = await fetch(detailUrl)
      const detailData = await detailRes.json()
      const place = detailData.result
      const hours = place.opening_hours?.weekday_text
      if (!hours) continue

      const todayIndex = (now.getDay() + 6) % 7
      const todayHours = hours[todayIndex]
      const match = todayHours.match(/: (.+) – (.+)/)
      if (!match) continue

      const closingTimeStr = match[2]
      const [closingHour, closingMin] = closingTimeStr.split(':').map(Number)
      const closingMinutes = closingHour * 60 + closingMin

      if (closingMinutes - currentMinutes >= 180) {
        const distKm = getDistanceInKm(
          latitude, longitude,
          place.geometry.location.lat,
          place.geometry.location.lng
        )

        candidates.push({
          name: place.name,
          address: place.formatted_address,
          rating: place.rating,
          distance_km: parseFloat(distKm.toFixed(2)),
          closing_time: closingTimeStr
        })
      }

      if (candidates.length >= 20) break
    }

    const topThree = candidates.sort((a, b) => a.distance_km - b.distance_km).slice(0, 3)
    return res.status(200).json({ data: topThree })

  } catch (err) {
    console.error('❌ 錯誤:', err)
    return res.status(500).json({ error: '伺服器錯誤', detail: String(err) })
  }
})

function getDistanceInKm(lat1, lon1, lat2, lon2) {
  const R = 6371.0088
  const x = deg2rad(lon2 - lon1) * Math.cos(deg2rad((lat1 + lat2) / 2))
  const y = deg2rad(lat2 - lat1)
  return Math.sqrt(x * x + y * y) * R
}

function deg2rad(deg) {
  return deg * (Math.PI / 180)
}

app.listen(3001, '0.0.0.0', () => {
  console.log('✅ hw2.js API 啟動於 http://localhost:3001')
})
