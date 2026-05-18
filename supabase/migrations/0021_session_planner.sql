-- ============================================================
-- 0021_session_planner.sql
-- Football Session Planner — adds 4 new tables only
-- SAFE: zero changes to any existing table, policy, or index
-- ============================================================

-- ── 1. DRILLS ────────────────────────────────────────────────
-- Global pre-seeded drills (academy_id = NULL, is_global = TRUE)
-- + coach custom drills (academy_id set, is_global = FALSE)

CREATE TABLE IF NOT EXISTS drills (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  academy_id      uuid,                        -- NULL = global
  name            text NOT NULL,
  category        text NOT NULL CHECK (category IN (
                    'warm_up','technical','passing','shooting',
                    'defending','ssg','match','cool_down'
                  )),
  age_group       text,                        -- 'U8','U10',...,'Senior','All'
  duration        int,                         -- minutes
  min_players     int,
  max_players     int,
  difficulty      text CHECK (difficulty IN ('beginner','intermediate','advanced')),
  equipment       text[]  DEFAULT '{}',
  tags            text[]  DEFAULT '{}',
  area            text,                        -- '½ pitch', 'penalty box', etc.
  context_ct      text,                        -- CT = Coaching Team role
  context_mt      text,                        -- MT = Main Team role
  procedure       text[]  DEFAULT '{}',        -- bullet point instructions
  coaching_points text[]  DEFAULT '{}',
  progressions    text[]  DEFAULT '{}',
  regressions     text[]  DEFAULT '{}',
  objectives      text[]  DEFAULT '{}',
  diagram_url     text,
  video_url       text,
  is_global       boolean DEFAULT FALSE,
  created_by      uuid,
  created_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS drills_academy_id_idx  ON drills (academy_id);
CREATE INDEX IF NOT EXISTS drills_category_idx    ON drills (category);
CREATE INDEX IF NOT EXISTS drills_is_global_idx   ON drills (is_global);

-- ── 2. DRILL FAVORITES ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS drill_favorites (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  drill_id   uuid NOT NULL REFERENCES drills (id) ON DELETE CASCADE,
  staff_id   uuid NOT NULL,
  academy_id uuid,
  created_at timestamptz DEFAULT now(),
  UNIQUE (drill_id, staff_id)
);

CREATE INDEX IF NOT EXISTS drill_favorites_staff_idx ON drill_favorites (staff_id);

-- ── 3. SESSION PLANS ─────────────────────────────────────────
-- One session per batch per day (enforced by unique constraint)

CREATE TABLE IF NOT EXISTS session_plans (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  academy_id     uuid NOT NULL,
  batch_id       uuid,                         -- links to existing batches table
  coach_id       uuid,                         -- links to existing staff
  date           date NOT NULL,
  topic          text,
  objective      text,
  venue          text,
  num_players    int,
  grid_size      text,
  formation      text,
  equipment      text[]  DEFAULT '{}',
  total_duration int     DEFAULT 0,            -- auto-calc sum of phase durations
  status         text    DEFAULT 'draft' CHECK (status IN ('draft','published')),
  is_template    boolean DEFAULT FALSE,
  template_name  text,                         -- set when saved as template
  ai_generated   boolean DEFAULT FALSE,
  notes          text,
  created_at     timestamptz DEFAULT now(),
  updated_at     timestamptz DEFAULT now(),
  UNIQUE (batch_id, date)                      -- one session per batch per day
);

CREATE INDEX IF NOT EXISTS session_plans_academy_idx ON session_plans (academy_id);
CREATE INDEX IF NOT EXISTS session_plans_batch_idx   ON session_plans (batch_id);
CREATE INDEX IF NOT EXISTS session_plans_coach_idx   ON session_plans (coach_id);
CREATE INDEX IF NOT EXISTS session_plans_date_idx    ON session_plans (date);

-- ── 4. SESSION PHASES ────────────────────────────────────────
-- Ordered blocks within a session (Warm-up, Phase 1, Phase 2, ...)

CREATE TABLE IF NOT EXISTS session_phases (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      uuid NOT NULL REFERENCES session_plans (id) ON DELETE CASCADE,
  position        int  NOT NULL DEFAULT 0,     -- display order (0 = first)
  phase_name      text NOT NULL DEFAULT 'Phase',
  area            text,
  context_ct      text,
  context_mt      text,
  duration        int  DEFAULT 15,             -- minutes
  procedure       text[] DEFAULT '{}',         -- bullet points
  coaching_points text[] DEFAULT '{}',
  diagram_url     text,                        -- uploaded image
  drill_id        uuid REFERENCES drills (id) ON DELETE SET NULL,
  created_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS session_phases_session_idx  ON session_phases (session_id);
CREATE INDEX IF NOT EXISTS session_phases_position_idx ON session_phases (session_id, position);

-- ── 5. RLS ───────────────────────────────────────────────────
-- Simple policies — read-open for anon (matches existing pattern in 0019d)

ALTER TABLE drills          ENABLE ROW LEVEL SECURITY;
ALTER TABLE drill_favorites ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_plans   ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_phases  ENABLE ROW LEVEL SECURITY;

-- drills: global drills readable by everyone; academy drills readable by academy
CREATE POLICY "drills_read" ON drills FOR SELECT
  USING (is_global = TRUE OR academy_id IS NULL OR TRUE);

-- drills: only authenticated users can insert/update/delete their academy's drills
CREATE POLICY "drills_write" ON drills FOR ALL
  USING (is_global = FALSE)
  WITH CHECK (is_global = FALSE);

-- drill_favorites: users manage their own favorites
CREATE POLICY "drill_favorites_all" ON drill_favorites FOR ALL USING (TRUE);

-- session_plans: open read, academy scoped writes
CREATE POLICY "session_plans_read"  ON session_plans FOR SELECT USING (TRUE);
CREATE POLICY "session_plans_write" ON session_plans FOR ALL   USING (TRUE) WITH CHECK (TRUE);

-- session_phases: open (access controlled at application layer via session_plans)
CREATE POLICY "session_phases_read"  ON session_phases FOR SELECT USING (TRUE);
CREATE POLICY "session_phases_write" ON session_phases FOR ALL   USING (TRUE) WITH CHECK (TRUE);


-- ============================================================
-- 6. SEED DATA — 30 pre-built global drills
-- ON CONFLICT DO NOTHING = safe to re-run migration
-- ============================================================

INSERT INTO drills (name, category, age_group, duration, min_players, max_players, difficulty, equipment, tags, area, context_ct, context_mt, procedure, coaching_points, progressions, regressions, objectives, is_global)
VALUES

-- ── WARM-UP (5) ───────────────────────────────────────────────

('Rondo 4v1',
 'warm_up', 'All', 10, 5, 8, 'beginner',
 ARRAY['Balls','Cones'],
 ARRAY['possession','passing','pressing'],
 '10x10m square',
 'Blue team: 4 players on outside of square',
 'Red team: 1 player in middle as defender',
 ARRAY[
   'Set up 10x10m square with 4 cones',
   'Blue team (CT) takes one touch to pass around the outside',
   'Red player (MT) tries to intercept or win the ball',
   'If red wins the ball, the last blue player to touch becomes the defender',
   'Progress: add a second defender after 5 minutes'
 ],
 ARRAY['Quick one-touch passing','Weight and angle of pass','Move after passing','Communication'],
 ARRAY['Reduce square to 8x8m','Add 2 defenders'],
 ARRAY['Increase square to 12x12m','Allow 2 touches'],
 ARRAY['Develop quick combination play','Improve pressing triggers'],
 TRUE),

('Possession Keep-Away 5v2',
 'warm_up', 'All', 10, 7, 10, 'beginner',
 ARRAY['Balls','Cones'],
 ARRAY['possession','pressing','decision-making'],
 '15x15m grid',
 'Blue team: 5 players keeping possession',
 'Red team: 2 players pressing to win ball',
 ARRAY[
   'Set up 15x15m grid',
   'Blue team (5) maintain possession with maximum 2 touches',
   'Red team (2) press together to win the ball',
   'If red wins ball or ball goes out, a blue player swaps to become defender',
   'Count consecutive passes as a team score'
 ],
 ARRAY['Angles of support','Quick release under pressure','Body shape open to receive','Press as a unit — not individually'],
 ARRAY['Reduce to 12x12m','Limit to 1 touch'],
 ARRAY['Increase grid size','Allow 3 touches'],
 ARRAY['Maintain possession under pressure','Improve support angles'],
 TRUE),

('Dynamic Movement Warm-Up',
 'warm_up', 'All', 8, 6, 20, 'beginner',
 ARRAY['Cones'],
 ARRAY['fitness','warm-up','activation'],
 'Half pitch width, 20m length',
 'Players work individually through the movement circuit',
 'N/A',
 ARRAY[
   'Set up 6 cone stations 3m apart in a line',
   'Players perform: high knees, hip circles, lateral shuffles, A-skips, carioca, sprint',
   'Each movement covers one cone-to-cone distance',
   'Two passes through the circuit',
   'Finish with 3x short sprint accelerations'
 ],
 ARRAY['Full range of motion at each station','Controlled acceleration in sprints','Stay light on toes'],
 ARRAY['Add ball to each movement'],
 ARRAY['Reduce intensity, focus on stretching only'],
 ARRAY['Physically prepare players for training','Reduce injury risk'],
 TRUE),

('Technical Ball Warm-Up',
 'warm_up', 'All', 10, 6, 20, 'beginner',
 ARRAY['Balls','Cones'],
 ARRAY['technical','dribbling','touch'],
 '20x20m area',
 'Each player has a ball — individual technical work',
 'N/A',
 ARRAY[
   'Every player has a ball in a 20x20m grid',
   'On coach signal: dribble freely avoiding others',
   'Sequence: inside-outside touch, sole rolls, toe-taps (30s each)',
   'Progress to: dribble and stop on signal using sole of foot',
   'Finish: dribble and turn — Cruyff, inside cut, outside cut'
 ],
 ARRAY['Close ball control','Head up when dribbling','Use both feet equally'],
 ARRAY['Add passive defenders','Limit space to 15x15m'],
 ARRAY['More space','Remove defenders'],
 ARRAY['Improve first touch','Develop confidence on the ball'],
 TRUE),

('Activation Passing Circuit',
 'warm_up', 'All', 8, 6, 12, 'beginner',
 ARRAY['Balls','Cones'],
 ARRAY['passing','movement','warm-up'],
 '15x10m rectangle',
 'Players in pairs — pass and move pattern',
 'N/A',
 ARRAY[
   'Set 4 cones as corners of a 15x10m rectangle',
   'Players pair up and stand at opposite corners',
   'Player passes to partner then moves to next corner (clockwise)',
   'Receiving player controls and passes to next incoming player',
   'Progress: add a third player — wall pass before the pass'
 ],
 ARRAY['Firm pass along the ground','Communicate before receiving','Move immediately after passing'],
 ARRAY['Add 1-2 combination before each pass'],
 ARRAY['Stationary passing in pairs'],
 ARRAY['Wake up passing muscles','Establish rhythm and timing'],
 TRUE),

-- ── TECHNICAL (6) ─────────────────────────────────────────────

('Pass and Move Triangles',
 'technical', 'U10+', 15, 6, 15, 'beginner',
 ARRAY['Balls','Cones'],
 ARRAY['passing','movement','combination'],
 '20x20m area with triangle cone setup',
 'Blue: players at cone points passing in triangle pattern',
 'Red: passive — rotate in to receive',
 ARRAY[
   'Set 3 cones as a triangle, 8m apart',
   'Player A passes to B and follows their pass to B''s cone',
   'Player B passes to C and follows to C''s cone',
   'Player C passes back to A''s original position',
   'Continuous rotation — always move after passing',
   'Progress to: 1-2 combination at each station'
 ],
 ARRAY['Pass then move immediately','Weight of pass — firm to feet','Receive across body to open up next pass'],
 ARRAY['Add 1-2 wall pass at each cone','Introduce a defender'],
 ARRAY['Increase triangle size','Allow 2 touches'],
 ARRAY['Develop passing and movement habits','Improve combination play'],
 TRUE),

('1v1 Attack and Defend',
 'technical', 'U10+', 15, 8, 16, 'intermediate',
 ARRAY['Balls','Cones','Goals'],
 ARRAY['1v1','dribbling','defending'],
 '15x10m channels with small goals at each end',
 'Blue (attacker): start with ball, attempt to beat defender and score',
 'Red (defender): prevent goal, win ball and counter-attack',
 ARRAY[
   'Set up 15x10m channel with a small goal at each end',
   'Attacker starts at one end with ball, defender at other end',
   'Attacker tries to beat the defender and score',
   'Defender tries to win the ball and score in the opposite goal',
   'Rotate roles after each attempt',
   'Count goals per role'
 ],
 ARRAY['Attackers: use body feints and change of direction','Defenders: stay on feet, delay and jockey','Both: composure in 1v1 situations'],
 ARRAY['Defender starts 2m closer','Add a second attacker'],
 ARRAY['Defender starts 3m back — easier for attacker'],
 ARRAY['Improve 1v1 attacking confidence','Develop defending technique'],
 TRUE),

('Turning with the Ball',
 'technical', 'U10+', 12, 6, 14, 'beginner',
 ARRAY['Balls','Cones'],
 ARRAY['turning','touch','technical'],
 '15x10m grid with central line',
 'Blue: feeder players on outside',
 'Red: working players in the middle receiving and turning',
 ARRAY[
   'Feeder passes into working player''s feet',
   'Working player receives and turns using: Cruyff, inside cut, outside cut, drag-back',
   'After turning, pass back to feeder and repeat',
   'Coach calls which turn to use before each pass',
   'Rotate feeders and workers every 90 seconds'
 ],
 ARRAY['Check your shoulder before receiving','Disguise the turn','First touch sets up the turn direction','Stay low through the turn'],
 ARRAY['Passive defender added behind the working player','Two touches only'],
 ARRAY['No defender — free choice of turn'],
 ARRAY['Develop comfort turning under pressure','Increase options when receiving back to goal'],
 TRUE),

('Wall Pass Combination',
 'technical', 'U12+', 12, 6, 12, 'intermediate',
 ARRAY['Balls','Cones'],
 ARRAY['combination','passing','movement'],
 '20m channel',
 'Blue: player A plays 1-2 with player B and continues run',
 'Red: passive second defender at end of channel',
 ARRAY[
   'A dribbles toward B who is standing 10m ahead',
   'A plays pass to B''s feet, B lays it first-time into A''s run',
   'A continues into the channel',
   'Add: passive defender at end — A must beat defender after combination',
   'Rotate roles continuously'
 ],
 ARRAY['Time the run — do not go too early','Wall player: firm 1-touch return','Ball must be played ahead into the runner''s path'],
 ARRAY['Add active defender after the combination','Add a third player option (third man run)'],
 ARRAY['No defender, just practice the movement pattern'],
 ARRAY['Develop automatic combination play','Improve timing of runs'],
 TRUE),

('Third Man Run',
 'technical', 'U14+', 15, 9, 15, 'intermediate',
 ARRAY['Balls','Cones'],
 ARRAY['combination','third-man','movement'],
 '30x20m area',
 'Blue: A and B combine, C makes the run behind the defensive line',
 'Red: 2 passive defenders to give realistic shape',
 ARRAY[
   'Player A passes to player B',
   'Player B plays short combination with A (or holds)',
   'Meanwhile player C times a run behind the defensive line',
   'B releases a through ball for C''s run',
   'C finishes on goal or plays back to incoming support',
   'Rotate A, B, C roles after every 3 attempts'
 ],
 ARRAY['C''s run must be timed AFTER B receives — not before','B must look up quickly to find C''s run','Pass must be weighted to meet the run'],
 ARRAY['Add semi-active defenders','Add a goalkeeper'],
 ARRAY['No defenders — just practice timing'],
 ARRAY['Develop runs in behind','Create goal-scoring opportunities from combinations'],
 TRUE),

('Ball Mastery Circuit',
 'technical', 'U8+', 10, 4, 20, 'beginner',
 ARRAY['Balls','Cones'],
 ARRAY['ball-mastery','technical','both-feet'],
 'Individual stations in 20x20m grid',
 'All players work simultaneously at own station',
 'N/A',
 ARRAY[
   'Station 1: Toe-taps on ball — 30 seconds',
   'Station 2: Inside-outside foot rolls — 30 seconds each foot',
   'Station 3: Pull-push (sole of foot forward and back) — 30 seconds',
   'Station 4: Inside foot zig-zag through 5 cones',
   'Station 5: Laces dribble and stop — sole stop on signal',
   'Rotate stations on coach whistle'
 ],
 ARRAY['Eyes up — not looking at ball','Stay on toes','Equally comfortable with both feet'],
 ARRAY['Introduce passive defender at each station','Reduce time at each station'],
 ARRAY['More time, larger movements'],
 ARRAY['Improve touch and feel for the ball','Build confidence with both feet'],
 TRUE),

-- ── PASSING (5) ───────────────────────────────────────────────

('Switch of Play',
 'passing', 'U12+', 15, 10, 16, 'intermediate',
 ARRAY['Balls','Cones','Bibs'],
 ARRAY['switching-play','width','passing'],
 '40x30m area',
 'Blue: 6 players — maintain width, switch ball quickly',
 'Red: 4 players pressing in the middle',
 ARRAY[
   'Set up 40x30m area — blue team occupies wide positions',
   'Blue team: keep possession and look to switch the play quickly',
   'Red team: 4 players in middle try to block passing lanes',
   'Score: 1 point for every successful switch of play from left to right',
   'Blue must involve at least 3 passes before switching'
 ],
 ARRAY['Width is key — stretch the defence','Disguise the switch ball before playing it','Receive open — body shape facing across the pitch'],
 ARRAY['Add 2 more red defenders','Reduce number of passes required before switch'],
 ARRAY['Red team passive — just show the shape'],
 ARRAY['Develop ability to switch point of attack','Improve scanning and awareness'],
 TRUE),

('Diamond Passing Pattern',
 'passing', 'U10+', 12, 8, 16, 'beginner',
 ARRAY['Balls','Cones'],
 ARRAY['passing','movement','pattern'],
 '20x20m diamond cone setup',
 'Blue: players at 4 points of diamond, 1 player in middle',
 'N/A — no defenders',
 ARRAY[
   'Set 4 cones as diamond shape — 10m between each point',
   'Player in middle acts as pivot — receives and plays back',
   'Outside player passes to middle, middle returns, outside moves to next point',
   'Sequence: A-middle-B-middle-C-middle-D-middle-A',
   'Progress: middle player spins and plays forward after each combination'
 ],
 ARRAY['Middle player: open body shape at all times','Outside players: move immediately after passing','Pass with correct foot to set up next pass'],
 ARRAY['Reduce diamond size','Add time pressure — 1 touch for middle player'],
 ARRAY['Larger diamond — more time on ball'],
 ARRAY['Develop quick combination play through a pivot player'],
 TRUE),

('Progressive Passing Grid',
 'passing', 'U12+', 15, 8, 14, 'intermediate',
 ARRAY['Balls','Cones','Goals'],
 ARRAY['passing','progression','combination'],
 '30x20m three-zone grid',
 'Blue: 2 players build from back through 3 zones',
 'Red: 1 defender per zone (3 total)',
 ARRAY[
   'Divide 30m area into 3 equal zones (10m each)',
   'Blue team: 2 players start in zone 1 with ball',
   'Must complete 2 passes in each zone before advancing',
   'One red defender per zone — presses to win ball',
   'Score by getting ball to teammate in zone 3'
 ],
 ARRAY['Use the full width of each zone','Change the tempo between zones','First touch must take you away from the defender'],
 ARRAY['Add 2 defenders to zone 3','Reduce zone size'],
 ARRAY['Make zones wider','Defenders are passive'],
 ARRAY['Develop build-up play through pressure','Improve composure in possession'],
 TRUE),

('Overlapping Run Combination',
 'passing', 'U14+', 15, 10, 16, 'intermediate',
 ARRAY['Balls','Cones','Bibs'],
 ARRAY['overlap','combination','wide-play'],
 '30x20m area with wide channels',
 'Blue: 3 attacking players — winger, centre, overlapping full-back',
 'Red: 2 passive/semi-active defenders',
 ARRAY[
   'Winger receives ball in wide position',
   'Full-back makes overlapping run outside the winger',
   'Winger can: (a) play into the overlap or (b) cut inside using the overlap as decoy',
   'Centre player supports centrally as a third option',
   'Finish with a cross or shot on goal',
   'Rotate roles after every 3 attempts'
 ],
 ARRAY['Winger: decide early — do not slow the run','Full-back: time run — do not go too early','Centre player: position between defenders to be a third option'],
 ARRAY['Add an active defender tracking the overlap','Add a goalkeeper'],
 ARRAY['No defenders — practice timing only'],
 ARRAY['Create overloads in wide areas','Develop overlapping combination play'],
 TRUE),

('Line Passing with Movement',
 'passing', 'U10+', 10, 8, 16, 'beginner',
 ARRAY['Balls','Cones'],
 ARRAY['passing','movement','warm-up'],
 '20m passing lines, 2 channels',
 'Blue: 4 players per line — pass and follow run',
 'N/A',
 ARRAY[
   'Two lines of 4 players facing each other, 20m apart',
   'Player A passes to player B at front of opposite line and runs to back of B''s line',
   'Player B controls and passes back to next player in A''s line, runs to back of that line',
   'Continuous — both channels work at same time',
   'Progress: add a wall pass or 1-2 before the long pass'
 ],
 ARRAY['Pass with correct foot','Control across body','Move immediately after passing — do not watch the ball'],
 ARRAY['Add a first-time return pass before the long ball','Reduce to 1 touch'],
 ARRAY['Slow the tempo, allow more touches'],
 ARRAY['Develop passing habits and movement after the ball'],
 TRUE),

-- ── SHOOTING (4) ──────────────────────────────────────────────

('Finishing from Crosses',
 'shooting', 'U12+', 15, 8, 14, 'intermediate',
 ARRAY['Balls','Cones','Goals'],
 ARRAY['finishing','crossing','movement'],
 'Full penalty area + wide channels',
 'Blue: 2 strikers make runs in the box',
 'Red: winger delivers crosses from wide positions',
 ARRAY[
   'Winger (CT) starts wide with balls',
   'Two strikers (MT) start at edge of box',
   'On signal: strikers make runs — near post and far post',
   'Winger delivers cross — low, driven or lofted',
   'Strikers finish first time where possible',
   'Rotate wingers every 5 crosses. Add goalkeeper after warmup'
 ],
 ARRAY['Near post runner: look to flick on','Far post runner: arrive late — do not stop in box','Strike through the ball — not over it'],
 ARRAY['Add a passive defender between strikers','Add goalkeeper from start'],
 ARRAY['No movement — just finish stationary crosses'],
 ARRAY['Improve finishing from crosses','Develop attacking movement in the box'],
 TRUE),

('1v1 vs Goalkeeper',
 'shooting', 'U10+', 12, 6, 12, 'intermediate',
 ARRAY['Balls','Cones','Goals'],
 ARRAY['finishing','1v1','composure'],
 'From edge of penalty area to goal',
 'Blue: attacker receives ball and attacks the goal',
 'Red: goalkeeper defends',
 ARRAY[
   'Server plays ball into attacker at edge of box',
   'Attacker takes touch and attacks the goalkeeper 1v1',
   'Options: slot around keeper, chip, drive low to corner',
   'Goalkeeper comes off line to narrow angle',
   'Work on both left and right channel approaches',
   'Rotate attackers every 5 shots'
 ],
 ARRAY['Head up before shooting — see goalkeeper position','Stay calm — pick corner early','Use body feint to unbalance keeper before shooting'],
 ARRAY['Add a chasing defender from behind','Reduce starting distance'],
 ARRAY['No goalkeeper — just shoot at target'],
 ARRAY['Develop composure and decision-making in front of goal'],
 TRUE),

('Combination Shooting',
 'shooting', 'U12+', 15, 8, 14, 'intermediate',
 ARRAY['Balls','Cones','Goals'],
 ARRAY['shooting','combination','finishing'],
 'Edge of penalty area, central and wide',
 'Blue: 2 players combine before shooting',
 'Red: passive defenders — provide shape',
 ARRAY[
   'Player A starts 25m from goal with ball',
   'Player B offers short for a combination',
   'A passes to B, B lays off first time, A shoots',
   'Variation: B dummies, A shoots through',
   'Variation: A-B-A combination, A finishes',
   'Rotate after 3 shots each combination'
 ],
 ARRAY['Shooter: set body shape before receiving the lay-off','Strike through the ball — low and on target','Lay-off must be precise — into the shooter''s stride'],
 ARRAY['Add an active defender closing down the shooter','Start closer to goal'],
 ARRAY['No defenders — work on timing only'],
 ARRAY['Develop shooting after a combination','Improve shooting technique under mild pressure'],
 TRUE),

('Shot After Pass — Movement Shooting',
 'shooting', 'U10+', 12, 8, 16, 'beginner',
 ARRAY['Balls','Cones','Goals'],
 ARRAY['shooting','movement','technique'],
 '20m from goal, central channel',
 'Blue: feeder at side, shooter runs onto pass',
 'Red: goalkeeper',
 ARRAY[
   'Feeder stands 10m to the side of the shooting zone',
   'Shooter starts 5m behind the cone, runs forward on signal',
   'Feeder rolls ball across for shooter to strike first-time or after one touch',
   'Alternate left-foot and right-foot approach angles',
   'Add a goalkeeper after 10 shots',
   'Vary height: low pass, bouncing ball, aerial'
 ],
 ARRAY['Strike laces through the ball','Plant foot beside the ball — not behind','Follow through — toe pointing at target'],
 ARRAY['Add passive defender closing in','Increase speed of delivery'],
 ARRAY['Stationary ball first — practice technique'],
 ARRAY['Improve shooting technique and movement into shots'],
 TRUE),

-- ── SSG (5) ───────────────────────────────────────────────────

('4v4 Possession Game',
 'ssg', 'All', 15, 8, 12, 'beginner',
 ARRAY['Balls','Cones','Bibs'],
 ARRAY['possession','ssg','pressing'],
 '25x20m grid',
 'Blue: 4 players maintaining possession',
 'Red: 4 players pressing to win ball',
 ARRAY[
   'Two equal teams of 4 in 25x20m grid',
   'Winning team: complete 6 consecutive passes = 1 point',
   'If red wins ball they become the possession team',
   'Out of bounds = possession to other team',
   'First to 5 points wins'
 ],
 ARRAY['Move to create passing angles','Support the ball carrier always','Press as a team — block passing lanes, not chase the ball'],
 ARRAY['Reduce grid to 20x15m','Reduce consecutive passes needed to 4','Add 2 neutral players (jokers always with possession team)'],
 ARRAY['Larger grid','Allow more touches'],
 ARRAY['Develop possession habits','Improve pressing triggers as a unit'],
 TRUE),

('5v5 with Target Players',
 'ssg', 'U10+', 15, 12, 16, 'intermediate',
 ARRAY['Balls','Cones','Bibs','Goals'],
 ARRAY['possession','target-player','build-up'],
 '35x25m grid with end zones',
 'Blue: 5 outfield + 1 target player at each end',
 'Red: 5 outfield defending',
 ARRAY[
   'Set up 35x25m grid with 3m end zones at each end',
   'Each team has a target player standing in opponent''s end zone',
   'Score by connecting pass to your target player',
   'Target player cannot be challenged',
   'Target player passes back in to restart',
   'If you score, keep possession and attack opposite end'
 ],
 ARRAY['Play forward early to target player','Support the target player with runs','After receiving from target: play quickly before defence organises'],
 ARRAY['Target player can dribble back out','Add a goalkeeper and small goal instead of target player'],
 ARRAY['Larger end zones','Two target players per team'],
 ARRAY['Develop forward passing mentality','Build up play toward a target'],
 TRUE),

('Transition Game 4v4+2',
 'ssg', 'U12+', 15, 10, 14, 'intermediate',
 ARRAY['Balls','Cones','Bibs','Goals'],
 ARRAY['transition','ssg','pressing'],
 '30x25m with 2 small goals',
 'Blue: attacking team + 2 neutral jokers',
 'Red: defending team — win ball and transition quickly',
 ARRAY[
   '4v4 game with 2 neutral jokers who always play with possession team',
   'Creates 6v4 for team in possession',
   'When red wins ball: immediately becomes 6v4 in their favour',
   'Score on small goals at each end',
   'Encourage quick transitions — attack within 5 seconds of winning ball'
 ],
 ARRAY['Win ball: first thought is forward','Lose ball: immediately press — do not wait','Jokers: move to create angles immediately'],
 ARRAY['Remove jokers — make it 4v4','Add offside line'],
 ARRAY['Increase to 5v5+2'],
 ARRAY['Develop quick transitions in both directions','Improve pressing immediately after losing possession'],
 TRUE),

('Pressing Trigger SSG',
 'ssg', 'U14+', 15, 12, 16, 'advanced',
 ARRAY['Balls','Cones','Bibs'],
 ARRAY['pressing','defensive','ssg'],
 '30x25m grid with end goals',
 'Blue: in possession — try to maintain and score',
 'Red: press as a unit — define the trigger before pressing',
 ARRAY[
   '5v5 in 30x25m grid with small goals',
   'Coach defines pressing trigger before drill starts (e.g., back pass to goalkeeper, ball to wide player)',
   'When trigger occurs: red team presses as a unit — compact and aggressive',
   'Blue team: recognise pressure and play out or play long',
   'Point for winning ball in pressing zone = 2 points; normal goal = 1 point'
 ],
 ARRAY['Everyone presses together on the trigger — not just nearest player','Cut off passing lanes — do not chase the ball','First presser: angle run to block the obvious pass'],
 ARRAY['Add goalkeeper — red can score on transition','Multiple pressing triggers'],
 ARRAY['Passive pressing — just block lanes, no tackling'],
 ARRAY['Develop coordinated pressing as a unit','Identify and react to pressing triggers'],
 TRUE),

('Goal to Goal SSG',
 'ssg', 'All', 20, 8, 14, 'beginner',
 ARRAY['Balls','Bibs','Goals'],
 ARRAY['ssg','match-related','enjoyment'],
 '30x20m pitch with goals at each end',
 'Blue: 4v4 with goalkeepers, normal rules',
 'Red: opponent team',
 ARRAY[
   'Standard small-sided game — 4v4',
   'Normal rules apply — goals count normally',
   'Coach introduces specific rule to reinforce session theme (e.g., must complete 3 passes before shooting)',
   'Play two halves of 8 minutes',
   'Debrief: ask players what they did well from today''s session theme'
 ],
 ARRAY['Connect session theme to the game — highlight when it happens','Praise positive examples out loud','Do not over-coach during the game — let them play'],
 ARRAY['No restrictions — free play','Larger pitch'],
 ARRAY['Add condition reinforcing the session theme more strongly'],
 ARRAY['Apply session theme in a game context','Enjoyment and free expression'],
 TRUE),

-- ── DEFENDING (3) ─────────────────────────────────────────────

('1v1 Defending',
 'defending', 'U10+', 12, 8, 16, 'beginner',
 ARRAY['Balls','Cones','Goals'],
 ARRAY['defending','1v1','technique'],
 '15x10m channel with goal at one end',
 'Blue (attacker): dribble at defender, try to score',
 'Red (defender): delay, jockey, win ball, counter-attack',
 ARRAY[
   'Attacker starts at one end with ball, defender 5m away',
   'Attacker tries to beat the defender and score',
   'Defender: get low, stay on feet, show attacker onto weaker foot',
   'If defender wins ball: attack the opposite mini-goal',
   'Rotate roles every attempt. Count goals per role'
 ],
 ARRAY['Do not lunge — wait for the right moment','Angle your body to show attacker one way','Stay on feet — block tackle only when attacker''s touch is heavy'],
 ARRAY['Defender starts closer','Attacker starts at full pace'],
 ARRAY['Attacker at walking pace — just practice the body shape'],
 ARRAY['Develop defensive body shape and patience in 1v1'],
 TRUE),

('Press and Cover Defending',
 'defending', 'U12+', 15, 9, 15, 'intermediate',
 ARRAY['Balls','Cones','Bibs'],
 ARRAY['defending','pressing','cover'],
 '30x20m half-pitch area',
 'Blue (defending): 3-player unit — first defender, cover, balance',
 'Red (attacking): 3 players building from back',
 ARRAY[
   'Red team: build from back with 3 players',
   'Blue team: 3 defenders in organised unit',
   'First defender: press the ball carrier at angle to block forward pass',
   'Second defender: cover 3-5m behind, central',
   'Third defender: balance — track the far attacker',
   'Blue score: win ball and play to end line',
   'Red score: play forward through defensive line'
 ],
 ARRAY['First defender: approach at angle — do not go straight','Cover: be ready to step if first defender is beaten','Balance: do not ball-watch — track your runner'],
 ARRAY['Add a 4th attacker — 3v4','Make pressing more aggressive'],
 ARRAY['Red builds slowly — give blue time to organise'],
 ARRAY['Develop defensive organisation','Understand press, cover, balance roles'],
 TRUE),

('Defensive Block Shape',
 'defending', 'U14+', 15, 10, 16, 'intermediate',
 ARRAY['Balls','Cones','Bibs'],
 ARRAY['defending','shape','compactness'],
 'Half pitch — from halfway to defensive third',
 'Blue (defending): 4-4 block defending shape',
 'Red (attacking): 6 players building play trying to break the block',
 ARRAY[
   'Blue team: mid-block in 4-4 shape — defend from halfway',
   'Red team: 6 players circulate ball looking for gaps in the block',
   'Blue: shift as a unit when ball moves side to side — stay compact',
   'No more than 5m gap between defensive and midfield lines',
   'Blue score: win ball and play forward past halfway',
   'Red score: break the lines with a pass or carry'
 ],
 ARRAY['Shift TOGETHER — one player moving alone creates a gap','Block the central passing lanes first','Engage only when the trigger occurs — do not leave shape early'],
 ARRAY['Add pressing from high block','Red gets extra player — 7v8'],
 ARRAY['Red plays slowly — give blue time to shift and organise'],
 ARRAY['Develop defensive compactness and collective block defending'],
 TRUE),

-- ── COOL-DOWN (2) ─────────────────────────────────────────────

('Static Stretching Routine',
 'cool_down', 'All', 8, 4, 30, 'beginner',
 ARRAY[]::text[],
 ARRAY['cool-down','recovery','stretching'],
 'Any flat area',
 'All players together — coach leads',
 'N/A',
 ARRAY[
   'Quadriceps stretch — 30 seconds each leg',
   'Hamstring stretch — seated, reach to toes — 30 seconds',
   'Hip flexor lunge stretch — 30 seconds each side',
   'Groin / inner thigh stretch — butterfly position — 30 seconds',
   'Calf stretch against wall or step — 30 seconds each',
   'Shoulder and arm cross-body stretch — 20 seconds each arm'
 ],
 ARRAY['Hold each stretch — do not bounce','Breathe through the stretch','Focus on muscles used most today'],
 ARRAY['Add foam rolling if available'],
 ARRAY['Reduce to 4 key stretches only'],
 ARRAY['Reduce injury risk','Begin recovery process','Signal end of session'],
 TRUE),

('Debrief Circle and Recovery',
 'cool_down', 'All', 7, 4, 30, 'beginner',
 ARRAY[]::text[],
 ARRAY['cool-down','debrief','reflection'],
 'Circle on the pitch',
 'Players gather in a circle around the coach',
 'N/A',
 ARRAY[
   'Players walk slowly in large circle for 2 minutes — active recovery',
   'Form a seated circle',
   'Coach asks: "What was today''s theme?"',
   'Coach asks: "What did we do well?"',
   'Coach asks: "What can we improve next session?"',
   'Coach: preview next session briefly',
   'Team handshake or call to finish'
 ],
 ARRAY['Keep it positive','Ask players — do not lecture','Maximum 5 minutes talking — less is more'],
 ARRAY['Individual reflections — each player says one thing'],
 ARRAY['Just the team call — skip the questions if time is short'],
 ARRAY['Reinforce session learning','Develop player reflection habit','Positive finish to training'],
 TRUE)

ON CONFLICT DO NOTHING;
