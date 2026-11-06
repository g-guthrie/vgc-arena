> Pilot run (harness vgc-arena/1, before the Fake Out alert fix: on turn 1 the observation wrongly told leads that Fake Out would fail). Kept as an example of transcript output.

# m-mw5b41qg-f8e365 — pilot: sonnet vs haiku

gen9championsvgc2026regmcbo3 · best of 3 · harness vgc-arena/1 · showdown 567c1ceddd

**Result:** Player A (claude-sonnet (Claude Code subagent)) wins 0–2 (won the set)

## p1: Player B (claude-haiku (Claude Code subagent))

**Team plan:** Balanced Fake Out/Intimidate lead core with Incineroar and Rillaboom for tempo, Garchomp as the mega-threat and spread Earthquake/Rock Slide pressure. Kingambit and Gholdengo handle bulky Steel/Fighting-weak targets and setup; Primarina covers Dragon and Fighting threats with Moonblast and Icy Wind speed-control damage. Win by keeping Protect-scouting, using Fake Out to set up Garchomp Mega, and using Gholdengo Nasty Plot once Intimidate pressure is established.

```
Incineroar @ Sitrus Berry  
Ability: Intimidate  
Level: 50  
EVs: 32 HP / 32 Atk / 2 SpD  
Adamant Nature  
- Fake Out  
- Flare Blitz  
- Parting Shot  
- Protect  

Garchomp @ Garchompite  
Ability: Rough Skin  
Level: 50  
EVs: 2 HP / 32 Atk / 32 Spe  
Jolly Nature  
- Earthquake  
- Rock Slide  
- Dragon Claw  
- Protect  

Kingambit @ Black Glasses  
Ability: Supreme Overlord  
Level: 50  
EVs: 32 HP / 32 Atk / 2 Def  
Adamant Nature  
- Kowtow Cleave  
- Sucker Punch  
- Iron Head  
- Protect  

Rillaboom @ Miracle Seed  
Ability: Grassy Surge  
Level: 50  
EVs: 32 HP / 32 Atk / 2 SpD  
Adamant Nature  
- Grassy Glide  
- Wood Hammer  
- U-turn  
- Protect  

Gholdengo @ Life Orb  
Ability: Good as Gold  
Level: 50  
EVs: 2 HP / 32 SpA / 32 Spe  
Timid Nature  
- Make It Rain  
- Shadow Ball  
- Nasty Plot  
- Protect  

Primarina @ Leftovers  
Ability: Torrent  
Level: 50  
EVs: 32 HP / 32 SpA / 2 SpD  
Modest Nature  
- Moonblast  
- Surf  
- Icy Wind  
- Protect  


```

## p2: Player A (claude-sonnet (Claude Code subagent))

**Team plan:** Balanced: Whimsicott Tailwind + Garchomp/Gengar offense, Incineroar Fake Out/Intimidate support, Rotom-Wash and Kingambit as bulk/closers. Mega Gengar with Icy Wind for speed control.

```
Incineroar @ Sitrus Berry  
Ability: Intimidate  
Level: 50  
EVs: 32 HP / 16 Atk / 8 Def / 10 SpD  
Careful Nature  
- Fake Out  
- Flare Blitz  
- Snarl  
- Parting Shot  

Garchomp @ Life Orb  
Ability: Rough Skin  
Level: 50  
EVs: 2 HP / 32 Atk / 32 Spe  
Jolly Nature  
- Earthquake  
- Dragon Claw  
- Rock Slide  
- Protect  

Rotom (Rotom-Wash) @ Leftovers  
Ability: Levitate  
Level: 50  
EVs: 32 HP / 16 Def / 18 SpA  
Modest Nature  
- Hydro Pump  
- Thunderbolt  
- Will-O-Wisp  
- Protect  

Whimsicott @ Focus Sash  
Ability: Prankster  
Level: 50  
EVs: 32 HP / 2 Def / 32 Spe  
Timid Nature  
- Tailwind  
- Moonblast  
- Encore  
- Protect  

Kingambit @ Black Glasses  
Ability: Defiant  
Level: 50  
EVs: 32 HP / 32 Atk / 2 SpD  
Adamant Nature  
- Kowtow Cleave  
- Sucker Punch  
- Iron Head  
- Low Kick  

Gengar @ Gengarite  
Ability: Cursed Body  
Level: 50  
EVs: 2 HP / 32 SpA / 32 Spe  
Timid Nature  
- Shadow Ball  
- Sludge Bomb  
- Icy Wind  
- Protect  


```

## Game 1 — Player A (claude-sonnet (Claude Code subagent)) wins (6 turns)

**p1 preview:** brings Incineroar, Garchomp, Kingambit, Rillaboom
  - **Key threats:** Whimsicott Tailwind/Encore on the back line and Gengar Mega's Shadow Ball/Icy Wind are the main threats; Gengar is handled by Kingambit Sucker Punch/Kowtow and Garchomp Earthquake. Their Incineroar Intimidate and Fake Out are answered by Protect-scouting and keeping Rillaboom as a pivot. Kingambit mirror is a 50-50 Defiant race so avoid trading Sucker Punch into Protect.
  - **Game plan:** Lead Incineroar and Garchomp: Fake Out the most dangerous attacker, Intimidate, then Garchomp Mega with Earthquake pressure. Preserve Garchomp and Incineroar for the endgame count; bring Rillaboom in to pressure Whimsicott and Rotom-Wash with Grassy Glide priority.

**p2 preview:** brings Whimsicott, Gengar, Incineroar, Garchomp
  - **Key threats:** Rillaboom Grassy Glide priority and terrain, Gholdengo Make It Rain/Nasty Plot, Mega Garchomp. Tailwind plus Mega Gengar outspeed most; Incineroar Intimidate blunts physicals.
  - **Game plan:** Lead Whimsicott + Gengar, Tailwind then Mega Gengar spam; Incineroar and Garchomp in back to pivot and clean up.

### Turn 1
- **p1** (move, full, 10s) → `move 2 1, move 3 2`
  - **Threats:** Gengar's Mega-Shadow Tag and Icy Wind spread threaten Garchomp, and Whimsicott's Tailwind gives them the speed lead. Tailwind plus Encore can lock my attackers.
  - **Win condition:** Trade Flare Blitz for Whimsicott's Focus Sash and keep Garchomp healthy for Mega Earthquake/Dragon Claw pressure later.
  - **Predictions:** foe1: Tailwind 50%; foe2: Shadow Ball 50%
  - **Reason:** Flare Blitz forces the Sash off Whimsicott and Dragon Claw pressures Gengar before Mega. Protect is kept in reserve.
  - **Risk:** If Gengar Mega-evolves and Icy Wind hits both, Garchomp drops fast; then I switch Garchomp to Rillaboom or Kingambit.
  - **Plan:** on track
  - **Prediction outcome:** foe1: ✗ (actual Protect); foe2: ✗ (actual Icy Wind)
- **p2** (move, full, 10s) → `move 4, move 3 mega`
  - **Threats:** Fake Out on Whimsicott blocks Tailwind; Garchomp Earthquake KOs Gengar.
  - **Win condition:** Get speed control and preserve Gengar and Garchomp for late game.
  - **Predictions:** foe1: Fake Out 70%; foe2: Dragon Claw 40%
  - **Reason:** Protect burns Fake Out while Mega Gengar Icy Winds Garchomp and slows both.
  - **Risk:** Earthquake KOs Gengar; adjust by Protecting Gengar next time.
  - **Plan:** on track
  - **Prediction outcome:** foe1: ✗ (actual Flare Blitz); foe2: ✓ (actual Dragon Claw)

### Turn 2
- **p2** (move, full, 7s) → `move 2 2, move 2 1`
  - **Threats:** Flare Blitz or Earthquake KO the low Gengar, but we outspeed both.
  - **Win condition:** Kill Garchomp now, keep outspeeding while they are slowed.
  - **Predictions:** foe1: Flare Blitz 50%; foe2: Protect 30%
  - **Reason:** Moonblast KOs Garchomp before it moves; Sludge Bomb hits Incineroar hard.
  - **Risk:** Garchomp Protect wastes Moonblast.
  - **Plan:** on track
  - **Prediction outcome:** foe1: ✓ (actual Flare Blitz); foe2: ✓ (actual Protect)
- **p1** (move, full, 17s) → `move 2 2, move 4`
  - **Threats:** Gengar-Mega is faster and its Icy Wind is hitting Garchomp (26%) hard. Whimsicott Moonblast can finish Garchomp too.
  - **Win condition:** Flare Blitz KOs the 36% Gengar, then Garchomp and Incineroar carry the Whimsicott side.
  - **Predictions:** foe1: Moonblast 50%; foe2: Icy Wind 50%
  - **Reason:** Gengar-Mega is at 36% and Flare Blitz KOs it from current HP; Protect keeps Garchomp alive, which is my only real win condition left.
  - **Risk:** If Gengar Protects (it has not used it), Flare Blitz is wasted and Garchomp is then one attack from fainting.
  - **Plan:** on track
  - **Prediction outcome:** foe1: ✓ (actual Moonblast); foe2: ✗ (actual Sludge Bomb)
- **p2** (switch, 5s) → `pass, switch 4`
  - **Reason:** Fast Garchomp can finish the slowed, weakened foes.

### Turn 3
- **p2** (move, full, 8s) → `move 2 2, move 1`
  - **Threats:** Fake Out flinch on Garchomp; Garchomp Dragon Claw.
  - **Win condition:** Remove both weakened foes this turn.
  - **Predictions:** foe1: Fake Out 50%; foe2: Dragon Claw 40%
  - **Reason:** Moonblast kills Garchomp, Earthquake kills Incineroar.
  - **Risk:** Fake Out on Garchomp stops the Earthquake.
  - **Plan:** on track
  - **Prediction outcome:** foe1: ✗ (actual Parting Shot); foe2: ✓ (actual Dragon Claw)
- **p1** (move, full, 15s) → `move 3 2, move 3 2`
  - **Threats:** Their Garchomp Earthquake/Dragon Claw is lethal to Incineroar (53%) and Garchomp (26%). Whimsicott Moonblast can finish Garchomp and Tailwind would give them the speed lead.
  - **Win condition:** Trade Incineroar's Parting Shot for Garchomp's Atk and bring in healthy Rillaboom as the main attacker; keep Kingambit for the endgame.
  - **Predictions:** foe1: Moonblast 60%; foe2: Dragon Claw 50%
  - **Reason:** Parting Shot weakens their Garchomp and pivots Incineroar out to preserve it, and Garchomp's Dragon Claw pressures their Garchomp.
  - **Risk:** If Parting Shot fails to pivot or Whimsicott Protects, Garchomp is exposed to Moonblast.
  - **Plan:** on track
  - **Prediction outcome:** foe1: ✓ (actual Moonblast); foe2: ✗ (actual Earthquake)
- **p1** (switch, 5s) → `switch 4, switch 3`
  - **Reason:** Only two Pokémon remain, so bring both in to fight Garchomp and Whimsicott with Grassy Glide priority and Sucker Punch.

### Turn 4
- **p1** (move, full, 14s) → `move 2 2, move 3 1`
  - **Threats:** Garchomp (Life Orb, 90%) Dragon Claw can hit Rillaboom for 36-62%, and Whimsicott's Moonblast plus Tailwind/Encore is the speed and control threat. Their last unseen Pokemon is the main unknown.
  - **Win condition:** Remove Whimsicott now with Iron Head, then trade Rillaboom and Kingambit into the last Garchomp and the unseen attacker with Grassy Terrain on my side.
  - **Predictions:** foe1: Moonblast 50%; foe2: Dragon Claw 60%
  - **Reason:** Iron Head KOs the 54% Whimsicott before it can set up Tailwind or Encore; Wood Hammer threatens to KO the Life Orb Garchomp.
  - **Risk:** If Whimsicott Protects or Garchomp survives Wood Hammer with a Life Orb hit, Rillaboom may be low; I would switch to Kingambit's bulk or pivot Rillaboom via U-turn.
  - **Plan:** Kill Whimsicott this turn, then take the Garchomp race with Rillaboom and Kingambit.
  - **Prediction outcome:** foe1: ✓ (actual Moonblast); foe2: ✓ (actual Dragon Claw)
- **p2** (move, full, 15s) → `move 2 1, move 2 1`
  - **Threats:** Kingambit with +2 Overlord Iron Head/Sucker Punch; Rillaboom Wood Hammer on Garchomp.
  - **Win condition:** Kill Rillaboom quickly then handle Kingambit with Garchomp EQ and Incineroar.
  - **Predictions:** foe1: Grassy Glide 50%; foe2: Iron Head 50%
  - **Reason:** Focusing Rillaboom likely kills it before it acts beyond priority Glide.
  - **Risk:** Rillaboom survives and Kingambit KOs Whimsicott.
  - **Plan:** on track
  - **Prediction outcome:** foe1: ✗ (actual Wood Hammer); foe2: ✓ (actual Iron Head)
- **p2** (switch, 7s) → `switch 3, pass`
  - **Reason:** Last Pokemon.

### Turn 5
- **p2** (move, full, 7s) → `move 2 2, pass`
  - **Threats:** Kingambit chip is small at -1 Atk.
  - **Win condition:** Flare Blitz it down.
  - **Predictions:** foe2: Kowtow Cleave 50%
  - **Reason:** Flare Blitz does 53-111% and they hit weakly.
  - **Risk:** Protect wastes a turn.
  - **Plan:** on track
  - **Prediction outcome:** foe2: ✓ (actual Kowtow Cleave)
- **p1** (move, full, 16s) → `pass, move 1 1`
  - **Threats:** Their Incineroar Flare Blitz (56-101%) is two-hit lethal to Kingambit, and Intimidate already dropped my Atk. Parting Shot would cut my offense again.
  - **Win condition:** Kowtow Cleave for 15-33% per hit with Supreme Overlord, needing about four hits; Protect only if they set up Parting Shot.
  - **Predictions:** foe1: Flare Blitz 70%
  - **Reason:** Kowtow Cleave cannot fail and is my highest guaranteed damage against Incineroar; Sucker Punch could fail to Parting Shot.
  - **Risk:** Two Flare Blitz hits KO Kingambit, so this race is likely lost unless they stop attacking.
  - **Plan:** Keep hitting with Kowtow Cleave and use Protect only if a Parting Shot or Snarl pattern emerges.
  - **Prediction outcome:** foe1: ✓ (actual Flare Blitz)

### Turn 6
- **p2** (move, light, 6s) → `move 2 2, pass`
  - **Predictions:** foe2: Protect 30%
  - **Reason:** Flare Blitz KOs.
  - **Plan:** on track
  - **Prediction outcome:** foe2: ✗ (actual Kowtow Cleave)
- **p1** (move, light, 15s) → `pass, move 1 1`
  - **Predictions:** foe1: Flare Blitz 75%
  - **Reason:** Kowtow Cleave is the highest guaranteed damage; Protect only delays one turn while Grassy Terrain heals them too.
  - **Plan:** Keep hitting with Kowtow Cleave; this is probably lost unless Incineroar stops attacking.
  - **Prediction outcome:** foe1: ✓ (actual Flare Blitz)

## Game 2 — Player A (claude-sonnet (Claude Code subagent)) wins (6 turns)

**p1 preview:** brings Incineroar, Primarina, Gholdengo, Kingambit
  - **Key threats:** Gengar-Mega with Shadow Tag and Icy Wind is their fastest damage and traps my non-Ghost leads, so Kingambit Sucker Punch/Kowtow must answer it. Whimsicott Tailwind and Encore run the speed and control; Gholdengo ignores status and Primarina's Icy Wind fights Tailwind. Garchomp Life Orb Earthquake is the late-game threat, answered by Primarina Moonblast since Dragon-type attackers cannot touch Fairy.
  - **Game plan:** Lead Incineroar and Primarina: Fake Out Whimsicott, then Icy Wind and Moonblast to pressure Garchomp and Gengar while preserving Incineroar's Parting Shot for endgame. Gholdengo comes in as a status-immune win condition with Make It Rain/Shadow Ball, and I keep Protect for the Gengar/Garchomp turns.
  - **Lessons:** Game 1: I threw Garchomp in at 26% and let Garchomp Earthquake overlap my Incineroar. Rillaboom was baited by Whimsicott Moonblast and Garchomp Dragon Claw, so this time I do not bring Garchomp and avoid spread moves that hit my own partner.

**p2 preview:** brings Whimsicott, Gengar, Incineroar, Garchomp
  - **Key threats:** Their Incineroar+Garchomp lead with Flare Blitz and Dragon Claw; Rillaboom Wood Hammer; Kingambit. Outspeed with Mega Gengar Icy Wind and kill Garchomp early.
  - **Game plan:** Same lead; Protect Gengar when Earthquake or Flare Blitz threatens, Icy Wind to slow, then Garchomp/Incineroar clean up.
  - **Lessons:** They used Flare Blitz and Dragon Claw into our lead and switched to Kingambit/Rillaboom; Wood Hammer on Garchomp trades via Rough Skin.

### Turn 1
- **p2** (move, full, 10s) → `move 1, move 2 2 mega`
  - **Threats:** Flare Blitz on Gengar and Primarina Moonblast/Surf; Fake Out stopping Tailwind.
  - **Win condition:** Mega Gengar picks off Primarina then Tailwind sweeps.
  - **Predictions:** foe1: Fake Out 50%; foe2: Moonblast 40%
  - **Reason:** Mega Sludge Bomb should KO Primarina before it moves.
  - **Risk:** Fake Out blocks Tailwind and Flare Blitz hits Gengar next turn.
  - **Plan:** on track
  - **Prediction outcome:** foe1: ✗ (actual Flare Blitz); foe2: ✓ (actual Moonblast)
- **p1** (move, full, 11s) → `move 2 1, move 1 1`
  - **Threats:** Whimsicott Tailwind and Encore control the speed and tempo, and Gengar-Mega Sludge Bomb can 2-hit KO Primarina. Gengar Shadow Tag can trap Incineroar.
  - **Win condition:** Remove Whimsicott this turn by burning its Focus Sash with Flare Blitz and finishing with Moonblast, then fight Gengar with Kingambit and Gholdengo.
  - **Predictions:** foe1: Tailwind 50%; foe2: Sludge Bomb 40%
  - **Reason:** Two attacks on Whimsicott break Focus Sash and KO it before Tailwind or Encore matters; Fake Out is likely to fail anyway per the harness.
  - **Risk:** If Whimsicott Protects, both attacks are wasted and Gengar-Mega gets a free turn; then I switch Primarina to Gholdengo.
  - **Plan:** on track
  - **Prediction outcome:** foe1: ✓ (actual Tailwind); foe2: ✓ (actual Sludge Bomb)
- **p1** (switch, 9s) → `pass, switch 4`
  - **Reason:** Kingambit is immune to Sludge Bomb (Steel) and resists Shadow Ball and Icy Wind, and Dark hits Gengar-Mega super effectively.

### Turn 2
- **p1** (move, full, 10s) → `move 2 1, move 1 2`
  - **Threats:** Gengar-Mega (Shadow Tag, Tailwind-boosted speed) traps Incineroar and Sludge Bombs it for 39-65%. Whimsicott at 1% can still Encore or Tailwind this turn.
  - **Win condition:** Kill Whimsicott and Gengar-Mega now, leaving them with Garchomp and Rotom-Wash/Kingambit against my Incineroar, Kingambit and Gholdengo.
  - **Predictions:** foe1: Protect 30%; foe2: Sludge Bomb 50%
  - **Reason:** Kowtow Cleave KOs the Mega Gengar guaranteed (108% min) even though it moves first, and Flare Blitz finishes the 1% Whimsicott.
  - **Risk:** If Gengar Protects, Kowtow is wasted and Tailwind stays up; then Kingambit should keep Kowtow for next turn.
  - **Plan:** on track
  - **Prediction outcome:** foe1: ✗ (actual Moonblast); foe2: ✗ (actual Protect)
- **p2** (move, full, 13s) → `move 2 1, move 4`
  - **Threats:** Kingambit Sucker Punch and Incineroar Flare Blitz can each KO Gengar; Whimsicott at 1 HP dies to anything.
  - **Win condition:** Keep Mega Gengar alive and use Tailwind turns for Garchomp.
  - **Predictions:** foe1: Flare Blitz 50%; foe2: Sucker Punch 40%
  - **Reason:** Protect Gengar from both KOs while Whimsicott chips as it can.
  - **Risk:** Gengar must still deal with Kingambit afterward.
  - **Plan:** Next turn switch Garchomp in or Icy Wind; Kingambit is the big problem for Gengar.
  - **Prediction outcome:** foe1: ✓ (actual Flare Blitz); foe2: ✗ (actual Kowtow Cleave)
- **p2** (switch, 11s) → `switch 4, pass`
  - **Reason:** Garchomp uses remaining Tailwind to hit hard.

### Turn 3
- **p2** (move, full, 9s) → `move 2 1, switch 3`
  - **Threats:** Kingambit Sucker Punch and Incineroar Flare Blitz KO Gengar; Earthquake would KO my own Gengar.
  - **Win condition:** Preserve Gengar for later, use Incineroar Intimidate to blunt Kingambit while Garchomp pressures.
  - **Predictions:** foe1: Flare Blitz 50%; foe2: Sucker Punch 40%
  - **Reason:** Gengar retreats into resisted hits and Intimidate; Garchomp pressures Incineroar.
  - **Risk:** Targets Garchomp with double hits; Kingambit Iron Head.
  - **Plan:** Intimidate, then Fake Out and Flare Blitz Kingambit; keep Gengar for Primarina/Gholdengo.
  - **Prediction outcome:** foe1: ✗ (actual Parting Shot); foe2: ✗ (actual Kowtow Cleave)
- **p1** (move, full, 10s) → `move 3 1, move 1 2`
  - **Threats:** Garchomp Life Orb Earthquake (67-117% on Incineroar, 50-88% on Kingambit) is the biggest damage in the match. Gengar-Mega Shadow Tag keeps Incineroar trapped, and Sludge Bomb is 2-hit lethal on it.
  - **Win condition:** Kowtow Cleave KOs Gengar-Mega (108%+ min), leaving Garchomp to face Kingambit and Gholdengo with Good as Gold, and Parting Shot's Atk drop cuts its Earthquake.
  - **Predictions:** foe1: Earthquake 50%; foe2: Shadow Ball 40%
  - **Reason:** Kowtow Cleave is my guaranteed KO on Gengar-Mega; Parting Shot lowers Garchomp's Atk so Earthquake stops threatening Incineroar outright.
  - **Risk:** If Gengar Protects (1/3 chance now) Kowtow is wasted and Garchomp's Earthquake still hits both of mine.
  - **Plan:** on track
  - **Prediction outcome:** foe1: ✗ (actual Dragon Claw); foe2: ✗ (actual switch)
- **p1** (switch, 5s) → `switch 3, pass`
  - **Reason:** Gholdengo is Ghost-type so Fake Out cannot hit it, and Good as Gold blocks Parting Shot and Snarl-type status.

### Turn 4
- **p2** (move, full, 8s) → `move 2 1, move 2 1`
  - **Threats:** Gholdengo Nasty Plot/Make It Rain, Kingambit Overlord growth.
  - **Win condition:** Kill Gholdengo with Flare Blitz while Tailwind lasts.
  - **Predictions:** foe1: Nasty Plot 40%; foe2: Sucker Punch 40%
  - **Reason:** Both hit Gholdengo before it moves; Flare Blitz likely KOs with Dragon Claw help.
  - **Risk:** Gholdengo Protect wastes turn.
  - **Plan:** on track
  - **Prediction outcome:** foe1: ✗ (actual Make It Rain); foe2: ✗ (actual Kowtow Cleave)
- **p1** (move, full, 10s) → `move 1, move 1 1`
  - **Threats:** Garchomp Earthquake does 52-92% to Gholdengo and 34-60% to Kingambit, and Incineroar Flare Blitz is SE on Gholdengo. Gengar-Mega waiting on the bench with Shadow Tag is a late threat.
  - **Win condition:** KO Garchomp now with Make It Rain plus Kowtow Cleave, then Gholdengo and Kingambit finish Incineroar before Gengar-Mega returns.
  - **Predictions:** foe1: Earthquake 50%; foe2: Flare Blitz 50%
  - **Reason:** Make It Rain hits both foes for 38-84% and 19-43%, and Kowtow adds 25-55% to Garchomp, which should KO the 90% Garchomp.
  - **Risk:** If Garchomp Earthquake lands first on Gholdengo and Incineroar Flare Blitzes it, Gholdengo can drop to 2 hits KO; Protect would be the fallback.
  - **Plan:** on track
  - **Prediction outcome:** foe1: ✗ (actual Dragon Claw); foe2: ✓ (actual Flare Blitz)
- **p1** (switch, 6s) → `switch 3, pass`
  - **Reason:** Only legal replacement; Incineroar's switch-in Intimidate cuts their Garchomp's Attack again.

### Turn 5
- **p1** (move, full, 10s) → `move 2 1, move 2 1`
  - **Threats:** Garchomp at 32% still Earthquakes for 32-59% and KOs my 15% Incineroar; Incineroar Flare Blitz (38-68%) is lethal-ish to Kingambit over two turns. Gengar-Mega is still on the bench.
  - **Win condition:** Kill Garchomp this turn with Sucker Punch (priority) plus Flare Blitz, then Kingambit must beat Incineroar and Gengar-Mega with Kowtow Cleave and Sucker Punch.
  - **Predictions:** foe1: Earthquake 50%; foe2: Flare Blitz 50%
  - **Reason:** Sucker Punch goes before Garchomp and Flare Blitz adds 18-39%, so the two together should KO the 32% Garchomp.
  - **Risk:** If Garchomp Protects, Sucker Punch fails and Incineroar is left to take Earthquake; I then switch nothing and rely on Kingambit.
  - **Plan:** on track
  - **Prediction outcome:** foe1: ✗ (actual Protect); foe2: ✓ (actual Flare Blitz)
- **p2** (move, full, 13s) → `move 4, move 2 2`
  - **Threats:** Garchomp at 32% can die to Kowtow Cleave, Flare Blitz or be flinched by Fake Out.
  - **Win condition:** Whittle Kingambit with Flare Blitz and finish Incineroar with Garchomp spread next turn.
  - **Predictions:** foe1: Fake Out 40%; foe2: Kowtow Cleave 50%
  - **Reason:** Protect blocks the likely attacks on Garchomp and burns Fake Out while Incineroar damages Kingambit.
  - **Risk:** They may hit Incineroar instead; Garchomp then kills Incineroar next turn.
  - **Plan:** on track
  - **Prediction outcome:** foe1: ✗ (actual Flare Blitz); foe2: ✗ (actual Sucker Punch)

### Turn 6
- **p2** (move, light, 6s) → `move 2 1, move 2 2`
  - **Predictions:** foe1: Protect 30%; foe2: Sucker Punch 40%
  - **Reason:** Each attack KOs its target.
  - **Plan:** on track
  - **Prediction outcome:** foe1: ✗ (actual Flare Blitz); foe2: ✗ (actual Kowtow Cleave)
- **p1** (move, light, 11s) → `move 2 1, move 1 1`
  - **Threats:** Garchomp Earthquake KOs my 15% Incineroar and hits Kingambit for 24-45%. Their Incineroar Flare Blitz KOs my burned 32% Kingambit.
  - **Win condition:** Flare Blitz plus Kowtow Cleave should KO the 32% Garchomp; then Kingambit must hold against Incineroar and Gengar-Mega.
  - **Predictions:** foe1: Earthquake 50%; foe2: Flare Blitz 50%
  - **Reason:** Flare Blitz and Kowtow together give more than the 32% Garchomp's HP, and Garchomp's Protect odds are now 1/3.
  - **Risk:** If Garchomp Earthquakes first, Incineroar dies and Kowtow alone leaves Garchomp at 5-19%.
  - **Plan:** on track
  - **Prediction outcome:** foe1: ✗ (actual Dragon Claw); foe2: ✓ (actual Flare Blitz)

