import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const RENDER_BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'https://gestion-comercial-dia.onrender.com';

export async function GET() {
  const target = RENDER_BACKEND_URL.replace(/\/$/, '');
  const timestamp = new Date().toISOString();
  console.log(`[Vercel-Cron] Despertando servidor en Render (${target}) a las ${timestamp}...`);

  try {
    // 1. Health check para levantar el contenedor de la hibernación (cold start)
    const healthRes = await fetch(`${target}/health`, {
      method: 'GET',
      headers: { 'User-Agent': 'Vercel-Cron-WakeBot/1.0' },
      cache: 'no-store',
    }).catch(err => ({ ok: false, status: 0, statusText: err.message }));

    // 2. Start call para asegurar que el scheduler esté activo en modo automático
    const startRes = await fetch(`${target}/api/mot-bot/start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Vercel-Cron-WakeBot/1.0',
      },
      body: JSON.stringify({ manual: false, autoWoken: true }),
      cache: 'no-store',
    }).catch(err => ({ ok: false, status: 0, statusText: err.message }));

    return NextResponse.json({
      ok: true,
      timestamp,
      target,
      healthStatus: healthRes.status,
      startStatus: startRes.status,
      message: 'Ping de auto-despertar ejecutado exitosamente desde Vercel Cron',
    });
  } catch (error: any) {
    console.error('[Vercel-Cron Error]', error);
    return NextResponse.json(
      {
        ok: false,
        timestamp,
        error: error.message || 'Error desconocido al despertar backend',
      },
      { status: 500 }
    );
  }
}
