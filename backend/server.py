#!/usr/bin/env python3
"""
Fedya Galaxy Explorer — Multiplayer WebSocket Server
=====================================================
2-player cooperative space shooter backend.

Run:
    pip install websockets
    python server.py [--host 0.0.0.0] [--port 8765]

Behind nginx/caddy: see backend/README.md
"""

import asyncio
import argparse
import json
import logging
import os
import random
import string
import time
import uuid
from collections import defaultdict
from pathlib import Path

import websockets
from websockets.server import WebSocketServerProtocol

# ── Logging ──────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("galaxy-mp")

# ── Constants ─────────────────────────────────────────────────────────────────
MAX_PLAYERS_PER_ROOM = 2
ROOM_IDLE_TIMEOUT    = 300        # seconds — clean up rooms with no activity
STATE_BROADCAST_HZ   = 20         # how often we rebroadcast collected states
WAVE_PAUSE           = 4.0        # seconds between waves
ENEMY_HP_MULTIPLIER  = 1.5        # MP enemies have 50 % more HP
ENEMY_COUNT_BONUS    = 0.5        # MP has 50 % more enemies per wave
PING_INTERVAL        = 25         # seconds between server-sent pings

LEADERBOARD_PATH = Path(__file__).parent / "leaderboard.json"

# Enemy templates per wave tier  (hp is BEFORE multiplier)
ENEMY_TEMPLATES = [
    {"type": "scout",    "hp": 30,  "speed": 2.0},
    {"type": "fighter",  "hp": 60,  "speed": 1.5},
    {"type": "bomber",   "hp": 120, "speed": 0.8},
    {"type": "elite",    "hp": 200, "speed": 1.2},
    {"type": "boss",     "hp": 600, "speed": 0.6},
]

UPGRADE_POOL = [
    {"id": "tripleShot",   "label": "Triple Shot",      "description": "Fire 3 bullets in a spread"},
    {"id": "rapidFire",    "label": "Rapid Fire",        "description": "+40 % fire rate"},
    {"id": "shield",       "label": "Energy Shield",     "description": "Absorbs one hit"},
    {"id": "speedBoost",   "label": "Afterburner",       "description": "+25 % ship speed"},
    {"id": "piercingShot", "label": "Piercing Rounds",   "description": "Bullets pass through enemies"},
    {"id": "wideBeam",     "label": "Wide Beam",         "description": "Laser sweeps a wider arc"},
    {"id": "homing",       "label": "Homing Missiles",   "description": "Missiles track nearest enemy"},
    {"id": "hpRegen",      "label": "Nano-Repair",       "description": "Slowly regenerate HP"},
]


# ── Leaderboard ───────────────────────────────────────────────────────────────

def load_leaderboard() -> list:
    if LEADERBOARD_PATH.exists():
        try:
            return json.loads(LEADERBOARD_PATH.read_text())
        except Exception:
            pass
    return []


def save_leaderboard(board: list) -> None:
    try:
        LEADERBOARD_PATH.write_text(json.dumps(board, indent=2))
    except Exception as exc:
        log.warning("Could not save leaderboard: %s", exc)


def add_scores_to_leaderboard(scores: list) -> None:
    board = load_leaderboard()
    for entry in scores:
        board.append({
            "name":  entry.get("name", "Unknown"),
            "score": entry.get("score", 0),
            "wave":  entry.get("wave", 1),
            "ts":    int(time.time()),
        })
    board.sort(key=lambda x: x["score"], reverse=True)
    board = board[:100]          # keep top 100
    save_leaderboard(board)


# ── Player ────────────────────────────────────────────────────────────────────

class Player:
    def __init__(self, ws: WebSocketServerProtocol, player_id: str, name: str):
        self.ws        = ws
        self.id        = player_id
        self.name      = name
        self.score     = 0
        self.hp        = 100
        self.dead      = False
        self.last_seen = time.monotonic()
        self.state: dict = {}      # latest ship state

    def to_dict(self) -> dict:
        return {"id": self.id, "name": self.name, "score": self.score, "hp": self.hp}

    async def send(self, msg: dict) -> None:
        if self.ws.open:
            try:
                await self.ws.send(json.dumps(msg))
            except Exception as exc:
                log.debug("Send to %s failed: %s", self.name, exc)


# ── Room ──────────────────────────────────────────────────────────────────────

class GameRoom:
    def __init__(self, code: str):
        self.code      = code
        self.players: dict[str, Player] = {}
        self.wave      = 0
        self.active    = False          # wave in progress
        self.enemies: dict[str, dict] = {}
        self.upgrade_turn_idx = 0       # alternates between players
        self.last_activity = time.monotonic()
        self._wave_task: asyncio.Task | None = None
        self._ping_task: asyncio.Task | None = None
        self._enemy_update_task: asyncio.Task | None = None

    # ── Player management ──────────────────────────────────────────────────

    def is_full(self) -> bool:
        return len(self.players) >= MAX_PLAYERS_PER_ROOM

    def add_player(self, player: Player) -> None:
        self.players[player.id] = player
        self.last_activity = time.monotonic()

    def remove_player(self, player_id: str) -> None:
        self.players.pop(player_id, None)
        self.last_activity = time.monotonic()

    def is_empty(self) -> bool:
        return len(self.players) == 0

    def player_list(self) -> list:
        return [p.to_dict() for p in self.players.values()]

    # ── Broadcast ──────────────────────────────────────────────────────────

    async def broadcast(self, msg: dict, exclude: str | None = None) -> None:
        coros = [
            p.send(msg)
            for pid, p in self.players.items()
            if pid != exclude
        ]
        if coros:
            await asyncio.gather(*coros, return_exceptions=True)

    async def broadcast_all(self, msg: dict) -> None:
        await self.broadcast(msg, exclude=None)

    # ── Wave management ────────────────────────────────────────────────────

    def _enemy_count_for_wave(self, wave: int) -> int:
        base = 5 + wave * 3
        return int(base * (1 + ENEMY_COUNT_BONUS))

    def _enemies_for_wave(self, wave: int) -> list[dict]:
        count    = self._enemy_count_for_wave(wave)
        enemies  = []
        tier_idx = min(wave - 1, len(ENEMY_TEMPLATES) - 1)
        # Mix lower tier and current tier enemies
        for i in range(count):
            tmpl = ENEMY_TEMPLATES[max(0, tier_idx - (0 if i % 3 == 0 else 1))].copy()
            enemy = {
                "id":   str(uuid.uuid4())[:8],
                "type": tmpl["type"],
                "x":    random.uniform(50, 750),
                "y":    random.uniform(-200, -30),
                "hp":   int(tmpl["hp"] * ENEMY_HP_MULTIPLIER),
                "wave": wave,
            }
            enemies.append(enemy)
        return enemies

    async def start_wave(self) -> None:
        self.wave  += 1
        self.active = True
        count      = self._enemy_count_for_wave(self.wave)
        enemies    = self._enemies_for_wave(self.wave)
        self.enemies = {e["id"]: e for e in enemies}

        log.info("Room %s: starting wave %d (%d enemies)", self.code, self.wave, count)
        await self.broadcast_all({"type": "wave_start", "wave": self.wave, "enemyCount": count})

        # Spawn enemies in batches so clients aren't overwhelmed
        batch_size = 5
        for i in range(0, len(enemies), batch_size):
            batch = enemies[i:i + batch_size]
            await self.broadcast_all({"type": "enemy_spawn", "enemies": batch})
            await asyncio.sleep(0.3)

    async def end_wave(self) -> None:
        self.active = False
        log.info("Room %s: wave %d complete", self.code, self.wave)

        if not self.players:
            return

        # Offer upgrades — players alternate each wave
        player_ids   = list(self.players.keys())
        chooser_id   = player_ids[self.upgrade_turn_idx % len(player_ids)]
        chooser      = self.players.get(chooser_id)
        self.upgrade_turn_idx += 1

        options = random.sample(UPGRADE_POOL, min(3, len(UPGRADE_POOL)))
        if chooser:
            await self.broadcast_all({
                "type":     "upgrade_choice",
                "playerId": chooser_id,
                "options":  options,
            })

        # Brief pause before next wave
        await asyncio.sleep(WAVE_PAUSE)
        if self.players:
            await self.start_wave()

    async def handle_enemy_kill(self, enemy_id: str, killer_id: str) -> None:
        enemy = self.enemies.pop(enemy_id, None)
        if enemy is None:
            return          # already dead (race condition between clients)

        player = self.players.get(killer_id)
        if player:
            player.score += 100 + self.wave * 10
            await self.broadcast_all({
                "type":     "sync_score",
                "playerId": killer_id,
                "score":    player.score,
            })

        # Check if all enemies dead
        if not self.enemies:
            await self.end_wave()

    # ── Periodic ping ──────────────────────────────────────────────────────

    async def _ping_loop(self) -> None:
        try:
            while self.players:
                await asyncio.sleep(PING_INTERVAL)
                await self.broadcast_all({"type": "ping"})
        except asyncio.CancelledError:
            pass

    # ── Enemy position broadcast loop ──────────────────────────────────────
    # In this simple server the clients are authoritative about enemy positions
    # (the server spawns them; clients simulate physics).  We just relay kill
    # events.  If you want full server-side simulation, expand this loop.

    # ── Game-over ──────────────────────────────────────────────────────────

    async def check_game_over(self) -> bool:
        alive = [p for p in self.players.values() if not p.dead]
        if alive:
            return False
        scores = [
            {"name": p.name, "score": p.score, "wave": self.wave}
            for p in self.players.values()
        ]
        scores.sort(key=lambda x: x["score"], reverse=True)
        add_scores_to_leaderboard(scores)
        log.info("Room %s: game over. Scores: %s", self.code, scores)
        await self.broadcast_all({"type": "game_over", "scores": scores})
        return True

    # ── Start ──────────────────────────────────────────────────────────────

    def start_background_tasks(self) -> None:
        self._ping_task = asyncio.create_task(self._ping_loop())

    def cancel_background_tasks(self) -> None:
        for task in (self._wave_task, self._ping_task, self._enemy_update_task):
            if task and not task.done():
                task.cancel()


# ── Server ────────────────────────────────────────────────────────────────────

class GameServer:
    def __init__(self):
        self.rooms: dict[str, GameRoom] = {}
        self._ws_to_player: dict[WebSocketServerProtocol, Player]   = {}
        self._ws_to_room:   dict[WebSocketServerProtocol, GameRoom]  = {}
        self._cleanup_task: asyncio.Task | None = None

    # ── Room helpers ───────────────────────────────────────────────────────

    def get_or_create_room(self, code: str) -> GameRoom:
        if code not in self.rooms:
            self.rooms[code] = GameRoom(code)
            log.info("Created room %s", code)
        return self.rooms[code]

    def remove_room(self, code: str) -> None:
        room = self.rooms.pop(code, None)
        if room:
            room.cancel_background_tasks()
            log.info("Removed room %s", code)

    # ── Connection handler ─────────────────────────────────────────────────

    async def handle_connection(self, ws: WebSocketServerProtocol) -> None:
        player: Player | None = None
        room:   GameRoom | None = None

        try:
            async for raw in ws:
                try:
                    msg = json.loads(raw)
                except json.JSONDecodeError:
                    await ws.send(json.dumps({"type": "error", "message": "Invalid JSON"}))
                    continue

                msg_type = msg.get("type")

                # ── join ──────────────────────────────────────────────────
                if msg_type == "join":
                    if player is not None:
                        await player.send({"type": "error", "message": "Already joined"})
                        continue

                    code = str(msg.get("room", "")).upper().strip()[:4]
                    name = str(msg.get("name", "Pilot"))[:20].strip() or "Pilot"

                    if not code:
                        await ws.send(json.dumps({"type": "error", "message": "Room code required"}))
                        continue

                    room = self.get_or_create_room(code)

                    if room.is_full():
                        await ws.send(json.dumps({"type": "error", "message": "Room full"}))
                        continue

                    player_id = str(uuid.uuid4())[:8]
                    player    = Player(ws, player_id, name)
                    room.add_player(player)
                    self._ws_to_player[ws]  = player
                    self._ws_to_room[ws]    = room

                    log.info("Player %s (%s) joined room %s  [%d/%d]",
                             name, player_id, code, len(room.players), MAX_PLAYERS_PER_ROOM)

                    # Tell the new player they joined
                    await player.send({
                        "type":     "joined",
                        "playerId": player_id,
                        "roomCode": code,
                        "players":  room.player_list(),
                    })

                    # Notify other players
                    await room.broadcast({
                        "type":     "player_joined",
                        "playerId": player_id,
                        "name":     name,
                    }, exclude=player_id)

                    # If room is now full, kick off the first wave
                    if room.is_full() and not room.active:
                        room.start_background_tasks()
                        asyncio.create_task(room.start_wave())

                # ── state sync ────────────────────────────────────────────
                elif msg_type == "state" and player and room:
                    player.last_seen = time.monotonic()
                    data = msg.get("data", {})
                    player.state = data
                    if data.get("hp") is not None:
                        player.hp = data["hp"]
                    if data.get("dead"):
                        player.dead = True
                        await room.check_game_over()
                    # Relay to others
                    await room.broadcast({
                        "type":     "player_state",
                        "playerId": player.id,
                        "data":     data,
                    }, exclude=player.id)

                # ── shoot ─────────────────────────────────────────────────
                elif msg_type == "shoot" and player and room:
                    await room.broadcast({
                        "type":     "player_shoot",
                        "playerId": player.id,
                        "data":     msg.get("data", {}),
                    }, exclude=player.id)

                # ── enemy kill ────────────────────────────────────────────
                elif msg_type == "enemy_kill" and player and room:
                    enemy_id = str(msg.get("data", {}).get("id", ""))
                    if enemy_id:
                        await room.handle_enemy_kill(enemy_id, player.id)

                # ── upgrade chosen ────────────────────────────────────────
                elif msg_type == "upgrade" and player and room:
                    upgrade_id = str(msg.get("upgradeId", ""))
                    log.info("Player %s chose upgrade: %s", player.name, upgrade_id)
                    # Broadcast so both clients apply the upgrade visually
                    await room.broadcast_all({
                        "type":      "upgrade_applied",
                        "playerId":  player.id,
                        "upgradeId": upgrade_id,
                    })

                # ── revive request ────────────────────────────────────────
                elif msg_type == "request_revive" and player and room:
                    # Tell living players that this player needs a revive
                    for pid, p in room.players.items():
                        if pid != player.id and not p.dead:
                            await p.send({
                                "type":       "revive_available",
                                "targetId":   player.id,
                                "targetName": player.name,
                            })

                # ── revive action ─────────────────────────────────────────
                elif msg_type == "revive" and player and room:
                    target_id = str(msg.get("targetId", ""))
                    target    = room.players.get(target_id)
                    if target and target.dead:
                        target.dead = True    # stays dead until next state push with hp>0
                        target.hp   = 50      # partial revive
                        target.dead = False
                        log.info("%s revived %s", player.name, target.name)
                        await room.broadcast_all({
                            "type":     "revived",
                            "targetId": target_id,
                            "revivedBy": player.id,
                        })
                        # Send target their new hp
                        await target.send({
                            "type": "player_state",
                            "playerId": target_id,
                            "data": {"hp": 50, "dead": False},
                        })

                # ── wave complete (client tells server) ───────────────────
                elif msg_type == "wave_complete" and player and room:
                    # We use server-side enemy tracking, so this is informational
                    pass

                # ── pong ──────────────────────────────────────────────────
                elif msg_type == "pong" and player:
                    player.last_seen = time.monotonic()

                # ── leave ─────────────────────────────────────────────────
                elif msg_type == "leave":
                    break

        except websockets.exceptions.ConnectionClosed:
            pass
        except Exception as exc:
            log.exception("Unhandled error for player %s: %s",
                          player.name if player else "?", exc)
        finally:
            await self._cleanup(ws, player, room)

    async def _cleanup(self,
                       ws: WebSocketServerProtocol,
                       player: Player | None,
                       room: GameRoom | None) -> None:
        self._ws_to_player.pop(ws, None)
        self._ws_to_room.pop(ws, None)

        if player and room:
            room.remove_player(player.id)
            log.info("Player %s left room %s  [%d remaining]",
                     player.name, room.code, len(room.players))

            if room.is_empty():
                self.remove_room(room.code)
            else:
                await room.broadcast({
                    "type":     "player_left",
                    "playerId": player.id,
                }, exclude=player.id)

    # ── Idle room cleanup ──────────────────────────────────────────────────

    async def _cleanup_idle_rooms(self) -> None:
        try:
            while True:
                await asyncio.sleep(60)
                now  = time.monotonic()
                dead = [
                    code for code, room in list(self.rooms.items())
                    if room.is_empty() or (now - room.last_activity) > ROOM_IDLE_TIMEOUT
                ]
                for code in dead:
                    log.info("Cleaning up idle room %s", code)
                    self.remove_room(code)
        except asyncio.CancelledError:
            pass

    def start(self) -> None:
        self._cleanup_task = asyncio.get_event_loop().create_task(
            self._cleanup_idle_rooms()
        )

    def stop(self) -> None:
        if self._cleanup_task:
            self._cleanup_task.cancel()


# ── HTTP health check (simple GET / → 200 OK) ────────────────────────────────
# Lets nginx / load balancers verify the process is alive.

async def health_check(ws: WebSocketServerProtocol) -> None:
    """
    websockets ≥ 12 uses process_request for non-WebSocket traffic.
    We handle it at the server level below.
    """
    pass


# ── Entry point ───────────────────────────────────────────────────────────────

async def main(host: str, port: int) -> None:
    server = GameServer()
    server.start()

    async def handler(ws: WebSocketServerProtocol) -> None:
        await server.handle_connection(ws)

    log.info("Galaxy Explorer multiplayer server starting on %s:%d", host, port)
    log.info("Leaderboard: %s", LEADERBOARD_PATH.resolve())

    async with websockets.serve(
        handler,
        host,
        port,
        ping_interval=None,        # we send our own pings
        ping_timeout=None,
        max_size=2**18,            # 256 KB max message
        origins=None,              # allow all origins (WebSocket CORS is origin-based)
        logger=logging.getLogger("websockets"),
    ):
        log.info("Server ready. Press Ctrl-C to stop.")
        try:
            await asyncio.Future()  # run forever
        except (KeyboardInterrupt, asyncio.CancelledError):
            pass
        finally:
            server.stop()
            log.info("Server shut down.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Galaxy Explorer Multiplayer Server")
    parser.add_argument("--host", default="0.0.0.0",  help="Bind host (default: 0.0.0.0)")
    parser.add_argument("--port", default=8765, type=int, help="Bind port (default: 8765)")
    args = parser.parse_args()

    asyncio.run(main(args.host, args.port))
