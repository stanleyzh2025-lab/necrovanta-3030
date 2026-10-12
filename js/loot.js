// ============================================================
// loot.js - chests of six rarities, their random loot (materials,
// ammo, healing, weapons), exploration chests / weapon caches,
// boss crates, and small pickups dropped by zombies.
// ============================================================

const Loot = {
  // ---------- chests ----------
  addChest(tx, ty, rarity, cache = false) {
    const chest = { tx, ty, x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE, rarity, cache, opened: false, openT: 0, bob: Math.random() * 6 };
    if (Net.role !== 'guest') Game.chests.push(chest);   // a guest's chests come from the host
    return chest;
  },

  // Spawn a chest on reachable open ground in a ring around the player.
  spawnChest(rarity = null, nearPlayer = false) {
    const p = Game.player;
    const minD = nearPlayer ? 3 : 6, maxD = nearPlayer ? 8 : 28;
    for (let tries = 0; tries < 80; tries++) {
      const a = Math.random() * Math.PI * 2, d = rand(minD, maxD);
      const tx = toTile(p.x + Math.cos(a) * d * TILE), ty = toTile(p.y + Math.sin(a) * d * TILE);
      if (!World.isOpenGround(tx, ty) || World.flowAt(tx, ty) === Infinity) continue;
      const t = World.tileAt(tx, ty);
      if (t === T.ROAD || t === T.CRATER || t === T.WATER) continue;
      if (Game.chests.some(c => !c.opened && Math.abs(c.tx - tx) + Math.abs(c.ty - ty) < 5)) continue;
      const r = rarity !== null ? rarity : weightedPick(rarityWeights(Math.max(1, Game.wave)));
      return this.addChest(tx, ty, r);
    }
    return null;
  },

  spawnBreakChests() {
    const p = Game.player;
    const near = Game.chests.filter(c => !c.opened && dist2(c.x, c.y, p.x, p.y) < (30 * TILE) ** 2).length;
    const n = Math.min(chestsPerBreak(Game.wave), MAX_CHESTS - near);
    for (let i = 0; i < n; i++) this.spawnChest();
  },

  nearestChest(p) {
    let best = null, bestD = 20 * 20;
    for (const c of Game.chests) {
      if (c.opened) continue;
      const d = dist2(p.x, p.y, c.x, c.y);
      if (d < bestD) { bestD = d; best = c; }
    }
    return best;
  },

  // Weapon rarity for a chest: usually its own tier, sometimes one lower, rarely one higher.
  rollWeapon(chestRarity) {
    const weights = [0, 0, 0, 0, 0, 0];
    weights[chestRarity] = 65;
    if (chestRarity > 0) weights[chestRarity - 1] = 30;
    if (chestRarity < 5) weights[chestRarity + 1] = 5;
    return pick(WEAPONS_BY_RARITY[weightedPick(weights)]).id;
  },

  // Give a weapon to the player and report it. Duplicates become free upgrades.
  // If the bag is full the weapon drops on the ground at (x, y) instead.
  grantWeapon(id, color, lines, x, y) {
    const p = Game.player, w = WEAPON_BY_ID[id];
    const res = Player.giveWeapon(p, id);
    const rc = RARITIES[w.rarity].color;
    if (res === 'full') {
      this.dropWeapon(id, 1, x + rand(-8, 8), y + 10);
      lines.unshift([`BAG FULL: ${w.name} DROPPED`, rc]);
      UI.toast(`BAG FULL! ${w.name.toUpperCase()} DROPPED - THROW A WEAPON OR UPGRADE YOUR BAG (I)`, '#ff3d4e');
      Sound.play('error');
    } else if (res === 'new') {
      lines.unshift([`NEW: ${w.name}!`, rc]);
      UI.toast(`NEW ${RARITIES[w.rarity].name} WEAPON: ${w.name.toUpperCase()}`, rc);
      Sound.play('upgrade');
    } else if (res === 'upgrade') {
      lines.unshift([`${w.name} LV${p.weapons[id]}!`, rc]);
      UI.toast(`${w.name.toUpperCase()} UPGRADED TO LV${p.weapons[id]}`, rc);
    } else {
      p.inv.metal += 10 + w.rarity * 4;
      lines.unshift([`+${10 + w.rarity * 4} METAL (MAX WEAPON)`, color]);
    }
  },

  // Unlocks a skin for one of your weapons (hotbar weapons are three times as
  // likely) and puts it on straight away. Switch skins in the MODS tab.
  grantSkin(lines, x, y) {
    const p = Game.player, options = [];
    for (const id in p.weapons) {
      const have = p.skins[id] || [];
      for (const sk in SKINS) if (!have.includes(sk)) options.push([id, sk, (p.hotbar.includes(id) ? 3 : 1) * SKINS[sk].weight]);
    }
    if (!options.length) {   // every skin already found: scrap it for materials instead
      p.inv.diamond += 2; p.inv.techshard += 4;
      lines.unshift(['+2 DIAMOND +4 TECH SHARD (ALL SKINS FOUND)', '#ffd040']);
      return;
    }
    let roll = Math.random() * options.reduce((a, o) => a + o[2], 0), pickO = options[0];
    for (const o of options) { roll -= o[2]; if (roll <= 0) { pickO = o; break; } }
    const [id, sk] = pickO, w = WEAPON_BY_ID[id], S = SKINS[sk];
    (p.skins[id] = p.skins[id] || []).push(sk);
    p.skin[id] = sk;
    lines.unshift([`${S.name.toUpperCase()} SKIN: ${w.name}!`, S.color]);
    UI.toast(`${S.name.toUpperCase()} SKIN UNLOCKED: ${w.name.toUpperCase()} (O = MODS)`, S.color);
    FX.burst(x, y - 6, S.color, 24, 90, 0.8);
    FX.ring(x, y, 30, S.color, 0.5);
    Sound.play('skin', x, y);
  },

  // Opening a chest. The chest itself belongs to the world (in multiplayer the
  // host opens it for everyone); the loot goes to whoever opened it.
  openChest(c, opener = Game.player) {
    if (c.opened) return;
    if (Net.role === 'guest') {
      if (!c.asked) { c.asked = true; Net.toHost({ k: 'open', tx: c.tx, ty: c.ty, s: Net.inputState() }); }
      return;
    }
    const rar = RARITIES[c.rarity];
    c.opened = true;
    if (c.explore) World.openedExplore.add(c.tx + ',' + c.ty);
    Save.touch();
    c.openT = 2.5;
    Game.score += rar.score;
    Sound.play('chest' + c.rarity, c.x, c.y);
    FX.burst(c.x, c.y, rar.color, 12 + c.rarity * 5, 70, 0.7);
    FX.ring(c.x, c.y, 16 + c.rarity * 4, rar.color, 0.4);
    FX.light(c.x, c.y, 60 + c.rarity * 12, rar.color, 0.8);
    if (opener.remote) Net.toPeer(opener.id, { k: 'loot', x: c.x, y: c.y, rarity: c.rarity, cache: c.cache ? 1 : 0, weapon: c.weapon || 0 });
    else this.grantChestLoot(c);
  },

  // The contents of a chest, added to your own survivor.
  grantChestLoot(c) {
    const p = Game.player;
    const rar = RARITIES[c.rarity];
    const table = LOOT_TABLE[rar.id];
    const lines = [];
    const give = (key, amount) => {
      if (amount <= 0) return;
      p.inv[key] = (p.inv[key] || 0) + amount;
      const col = MATERIALS[key] ? MATERIALS[key].color : AMMO[key] ? AMMO[key].color : '#5fe05f';
      lines.push([`+${amount} ${itemName(key)}`, col]);
    };
    give(pick(['wood', 'stone']), Classes.lootAmount(p, rollRange(table.mats)));
    give(pick(['wood', 'stone']), Classes.lootAmount(p, rollRange(table.mats) >> 1));
    give('metal', Classes.lootAmount(p, rollRange(table.metal)));
    for (const k in table.ammo) give(k, rollRange(table.ammo[k]));
    for (const k in table.adv) give(k, Classes.lootAmount(p, rollRange(table.adv[k])));
    if (Math.random() < 0.6 + c.rarity * 0.08) give(pick(table.heal), 1);

    // Weapon caches always hold a weapon of their tier; normal chests have a small chance.
    if (c.cache) this.grantWeapon(c.weapon || pick(WEAPONS_BY_RARITY[c.rarity]).id, rar.color, lines, c.x, c.y);
    else if (Math.random() < CHEST_WEAPON_CHANCE[c.rarity] * Classes.stat(p, 'chestWeapon')) this.grantWeapon(this.rollWeapon(c.rarity), rar.color, lines, c.x, c.y);

    // Skins: mythic chests always hold one, legendary chests sometimes.
    if (Math.random() < SKIN_CHANCE[c.rarity]) this.grantSkin(lines, c.x, c.y);

    lines.slice(0, 7).forEach(([text, color], i) => FX.float(c.x, c.y - 14 - i * 7, text, color, 1.6 + i * 0.1));
    UI.toast(`${rar.name} ${c.cache ? 'WEAPON CACHE' : 'CHEST'} OPENED`, rar.color);
    UI.dirty = true;
  },

  updateChests(dt) {
    const p = Game.player;
    for (let i = Game.chests.length - 1; i >= 0; i--) {
      const c = Game.chests[i];
      if (c.opened) {
        c.openT -= dt;
        if (c.openT <= 0) Game.chests.splice(i, 1);
        continue;
      }
      if (Math.abs(c.x - p.x) > 400 || Math.abs(c.y - p.y) > 300) continue;   // only animate nearby chests
      c.bob += dt * 3;
      if (c.rarity >= 3 && Math.random() < 0.05 * c.rarity * dt * 20) {
        FX.puff(c.x + rand(-6, 6), c.y - 4, RARITIES[c.rarity].light, -15, 0.6);
      }
    }
  },

  // ---------- weapons on the ground ----------
  dropWeapon(id, level, x, y, mag = null) {
    // Don't drop inside a wall: nudge toward the player until the spot is free.
    const p = Game.player;
    for (let i = 0; i < 8 && solidAt(x, y, 3); i++) { x = lerp(x, p.x, 0.3); y = lerp(y, p.y, 0.3); }
    Game.groundWeapons.push({ id, level, mag, x, y, t: Math.random() * 6 });
    FX.burst(x, y, RARITIES[WEAPON_BY_ID[id].rarity].color, 8, 40, 0.4);
  },

  nearestGroundWeapon(p) {
    let best = null, bestD = 18 * 18;
    for (const gw of Game.groundWeapons) {
      const d = dist2(p.x, p.y, gw.x, gw.y);
      if (d < bestD) { bestD = d; best = gw; }
    }
    return best;
  },

  pickUpWeapon(gw) {
    const p = Game.player, w = WEAPON_BY_ID[gw.id];
    const res = Player.giveWeapon(p, gw.id, gw.level, gw.mag);
    if (res === 'full') {
      UI.toast('BAG FULL! THROW A WEAPON OR UPGRADE YOUR BAG (I)', '#ff3d4e');
      Sound.play('error');
      return;
    }
    Game.groundWeapons.splice(Game.groundWeapons.indexOf(gw), 1);
    const rc = RARITIES[w.rarity].color;
    if (res === 'new') FX.float(gw.x, gw.y - 12, `${w.name} LV${gw.level}`, rc, 1.2);
    else FX.float(gw.x, gw.y - 12, res === 'upgrade' ? `${w.name} LV${p.weapons[gw.id]}!` : 'MAX LEVEL', rc, 1.2);
    FX.burst(gw.x, gw.y, rc, 10, 50, 0.4);
    Sound.play('pickup');
  },

  // ---------- zombie drops ----------
  zombieDrops(z) {
    const drop = (kind, amount) => Game.drops.push({ kind, amount, x: z.x + rand(-7, 7), y: z.y + rand(-7, 7), t: 0 });
    if (z.type.boss) {
      for (const k in BOSS_DROPS) {
        const n = rollRange(BOSS_DROPS[k]);
        if (n > 0) drop(k, n);
      }
      drop('cells', 20); drop('plasma', 10); drop('heal', 25);
      // Rare Mod Kits (Mk II / Mk III mod upgrades) only come from Titans.
      drop('modkit', z.type.final ? 3 : z.type.reward ? z.type.reward.kits : MODKIT_TITAN_DROP);
      // Boss reward: a weapon crate (epic or better) right where the Titan fell.
      if (!z.type.named && Math.random() < BOSS_WEAPON_CHANCE) {   // named bosses always drop their own crate
        const r = weightedPick([0, 0, 0, 40, 45, 15]);
        this.addChest(toTile(z.x), toTile(z.y), r, true);
        UI.toast(`${RARITIES[r].name} BOSS WEAPON CRATE DROPPED!`, RARITIES[r].color);
      }
      return;
    }
    for (const d of DROPS) {
      if (d.minWave && Game.wave < d.minWave) continue;
      if (d.types && !d.types.includes(z.id)) continue;
      if (Math.random() < d.chance) drop(d.kind, rollRange(d.amount));
    }
  },

  updateDrops(dt) {
    const players = Net.livePlayers();
    for (let i = Game.drops.length - 1; i >= 0; i--) {
      const d = Game.drops[i];
      d.t += dt;
      let p = players[0];
      for (const q of players) if (dist2(d.x, d.y, q.x, q.y) < dist2(d.x, d.y, p.x, p.y)) p = q;
      if (!p) continue;
      const dd = dist(d.x, d.y, p.x, p.y);
      if (dd < 40) {   // magnet
        const pull = (1 - dd / 40) * 160 * dt + 30 * dt;
        d.x += (p.x - d.x) / (dd || 1) * pull;
        d.y += (p.y - d.y) / (dd || 1) * pull;
      }
      if (dd < 8) {
        if (d.kind === 'heal') {
          const amt = d.amount * Classes.stat(p, 'heal');
          p.hp = Math.min(p.maxHp, p.hp + amt);
          FX.float(p.x, p.y - 14, `+${Math.round(amt)} HP`, '#5fe05f');
        } else {
          p.inv[d.kind] = (p.inv[d.kind] || 0) + d.amount;
          const col = MATERIALS[d.kind] ? MATERIALS[d.kind].color : AMMO[d.kind].color;
          FX.float(p.x, p.y - 14, `+${d.amount} ${itemName(d.kind)}`, col);
          if (d.kind === 'modkit' && !p.remote) {
            UI.toast(`+${d.amount} MOD KIT${d.amount > 1 ? 'S' : ''}! UPGRADE MODS TO MK II / MK III AT AN ANVIL (O)`, col);
            Sound.play('skin');
          }
        }
        Sound.play('pickup');
        UI.dirty = true;
        Game.drops.splice(i, 1);
      } else if (d.t > 30) {
        Game.drops.splice(i, 1);
      }
    }
  },
};
