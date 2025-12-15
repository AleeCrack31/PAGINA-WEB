// rcon-client.js
import 'dotenv/config';
import { Rcon } from 'rcon-client';

let rcon = null;

export async function connect() {
  const host = process.env.RCON_HOST;
  const port = Number(process.env.RCON_PORT);
  const password = process.env.RCON_PASSWORD;

  if (!host || !port || isNaN(port) || !password) {
    throw new Error(`RCON mal configurado. Revisa tu .env:
    RCON_HOST=${host}
    RCON_PORT=${port}
    RCON_PASSWORD=${password ? '***' : '(vacío)'}`);
  }

  if (rcon && rcon.socket && rcon.socket.writable) return rcon;

  rcon = await Rcon.connect({ host, port, password });
  return rcon;
}

export async function send(command) {
  try {
    const conn = await connect();
    return await conn.send(command);
  } catch (e) {
    console.error('Error RCON:', e.message);
    throw e;
  }
}

