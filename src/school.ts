import { CANVAS_HEIGHT, CANVAS_WIDTH, FISH, MAX_FISH } from "./config";
import { Koi, SwimState } from "./koi";
import { TinyFishSchools } from "./tiny-fish";
import {
  add,
  clamp,
  fromAngle,
  length,
  mul,
  normalize,
  perpendicular,
  sub,
  type Vec2,
  vec,
  wrapAngle,
  XorShift32,
} from "./math";
import { RippleSystem } from "./ripple-system";
import { advanceTrail } from "./projection/activities/swim-motion";
import {
  waterClearance,
  projectIntoWater,
  fishWaterMargin,
  containFishAfterResize,
} from "./projection/activities/pond-boundary";

export class School {
  public containToWater = false;
  public boundaryCorrections = 0;
  public avoidanceRegions: {
    x: number;
    y: number;
    radius: number;
    strength: number;
  }[] = [];
  public readonly fish: Koi[] = Array.from(
    { length: MAX_FISH },
    () => new Koi(),
  );
  public readonly ripples = new RippleSystem();
  public readonly tinyFish = new TinyFishSchools();

  public count: number = FISH.initialCount;
  public targetActive = false;

  private random = new XorShift32();
  private target = vec(CANVAS_WIDTH * 0.5, CANVAS_HEIGHT * 0.5);
  private targetAge = 0;

  public constructor() {
    this.fish.forEach((fish, index) => fish.reset(index, this.random));
  }

  public setCount(count: number): void {
    this.count = clamp(Math.round(count), 1, MAX_FISH);
  }

  public updateBodyProportions(previous: {
    regularLength: readonly [number, number];
    tinyLength: readonly [number, number];
    regularWidthRatio: readonly [number, number];
    tinyWidthRatio: readonly [number, number];
    tinyEvery: number;
  }): void {
    const midpoint = (range: readonly [number, number]): number =>
      (range[0] + range[1]) * 0.5;
    for (const [index, fish] of this.fish.entries()) {
      const wasTiny = index % previous.tinyEvery === previous.tinyEvery - 1;
      const isTiny = index % FISH.tinyEvery === FISH.tinyEvery - 1;
      const oldLength = midpoint(
        wasTiny ? previous.tinyLength : previous.regularLength,
      );
      const newLength = midpoint(isTiny ? FISH.tinyLength : FISH.regularLength);
      const oldWidth = midpoint(
        wasTiny ? previous.tinyWidthRatio : previous.regularWidthRatio,
      );
      const newWidth = midpoint(
        isTiny ? FISH.tinyWidthRatio : FISH.regularWidthRatio,
      );
      const lengthRatio = newLength / Math.max(oldLength, 0.001);
      fish.bodyLength *= lengthRatio;
      fish.bodyWidth *= (lengthRatio * newWidth) / Math.max(oldWidth, 0.001);
    }
  }

  public resize(scaleX: number, scaleY: number): void {
    for (const fish of this.fish) {
      const nextX = fish.position.x * scaleX;
      const nextY = fish.position.y * scaleY;
      const shiftX = nextX - fish.position.x;
      const shiftY = nextY - fish.position.y;
      fish.position.x = nextX;
      fish.position.y = nextY;
      for (const node of fish.spine) {
        node.x += shiftX;
        node.y += shiftY;
      }
      for (const node of fish.renderSpine) {
        node.x += shiftX;
        node.y += shiftY;
      }
    }
    for (const fish of this.fish) {
      for (const point of fish.trail) {
        point.x *= scaleX;
        point.y *= scaleY;
      }
    }
    if (this.containToWater)
      for (const fish of this.fish)
        containFishAfterResize(fish, CANVAS_WIDTH, CANVAS_HEIGHT);
    this.target.x *= scaleX;
    this.target.y *= scaleY;
    this.tinyFish.resize(scaleX, scaleY);
    for (const ripple of this.ripples.instances) {
      ripple.center.x *= scaleX;
      ripple.center.y *= scaleY;
    }
  }

  public reset(): void {
    this.random.state = 0x00c0ffee;
    this.fish.forEach((fish, index) => fish.reset(index, this.random));
    this.tinyFish.reset();
    this.ripples.reset();
    this.targetActive = false;
  }

  public setRainIntensity(intensity: number): void {
    this.ripples.setRainIntensity(intensity);
  }

  public callTo(point: Vec2): void {
    this.target = { ...point };
    this.targetActive = true;
    this.targetAge = 0;
    for (let index = 0; index < this.count; index += 1) {
      const fish = this.fish[index];
      const response = FISH.callResponse;
      const distanceToCall = length(sub(fish.position, point));
      const distanceAmount = Math.pow(
        clamp(distanceToCall / response.distanceAtMaximumDelay, 0, 1),
        response.distanceExponent,
      );
      fish.callDelay =
        response.minimumDelaySeconds +
        distanceAmount * response.maximumDistanceDelaySeconds +
        this.random.range(0, response.randomJitterSeconds) +
        (1 - fish.reactivity) * response.temperamentDelaySeconds;
      fish.respondedToCall = false;
      fish.callResponseAge = 0;
    }
    this.tinyFish.fleeFrom(point);
    this.ripples.trigger("touch", point);
  }

  public scatter(): void {
    for (let index = 0; index < this.count; index += 1) {
      const fish = this.fish[index];
      fish.heading += this.random.range(-1.35, 1.35);
      fish.speed = fish.maximumSpeed;
      fish.angularVelocity += this.random.range(-2, 2);
      this.enterState(fish, SwimState.Burst);
    }
    this.targetActive = false;
  }

  public update(dt: number, time: number): void {
    this.targetAge += dt;
    if (
      this.targetActive &&
      this.targetAge > FISH.callResponse.targetLifetimeSeconds
    ) {
      this.targetActive = false;
    }

    const desired: Vec2[] = [];
    const desiredSpeed: number[] = [];
    for (let index = 0; index < this.count; index += 1) {
      const fish = this.fish[index];
      fish.callDelay = Math.max(0, fish.callDelay - dt);
      if (this.targetActive && fish.respondedToCall) {
        fish.callResponseAge += dt;
      }
      if (this.targetActive && fish.callDelay <= 0 && !fish.respondedToCall) {
        fish.respondedToCall = true;
        fish.callResponseAge = 0;
        fish.targetDepth = FISH.depth.callRiseDepth;
        fish.depthTransitionRate =
          3 / Math.max(FISH.depth.callRiseSeconds, 0.1);
        this.enterState(fish, SwimState.Burst);
      }
      this.updateNaturalState(fish, dt);
      this.updateDepth(fish, dt);
      this.updateFeeding(fish, dt);
      desired[index] = this.steeringFor(index, time);
      desiredSpeed[index] = this.desiredSpeedFor(index);
    }
    for (let index = 0; index < this.count; index += 1) {
      const fish = this.fish[index];
      this.integrate(fish, desired[index], desiredSpeed[index], dt);
    }
    this.tinyFish.update(dt, time);

    this.ripples.update(dt);
  }

  private updateDepth(fish: Koi, dt: number): void {
    fish.depthStateAge += dt;
    const risingForCall = this.targetActive && fish.respondedToCall;
    if (!risingForCall && fish.depthStateAge >= fish.depthStateDuration) {
      fish.depthStateAge = 0;
      if (this.behaviorUnit(fish) < FISH.depth.changeProbability) {
        fish.inDeepPeriod = !fish.inDeepPeriod;
      }
      const range = fish.inDeepPeriod
        ? FISH.depth.deepRange
        : FISH.depth.shallowRange;
      const durations = fish.inDeepPeriod
        ? FISH.depth.deepDurationSeconds
        : FISH.depth.surfaceDurationSeconds;
      fish.targetDepth = this.behaviorRange(fish, range[0], range[1]);
      fish.depthStateDuration = this.behaviorRange(
        fish,
        durations[0],
        durations[1],
      );
      const transitionSeconds = this.behaviorRange(
        fish,
        FISH.depth.transitionSeconds[0],
        FISH.depth.transitionSeconds[1],
      );
      fish.depthTransitionRate = 3 / Math.max(transitionSeconds, 0.1);
    }

    fish.depth +=
      (fish.targetDepth - fish.depth) *
      (1 - Math.exp(-fish.depthTransitionRate * dt));
  }

  private updateFeeding(fish: Koi, dt: number): void {
    fish.gulpAnimation = Math.max(0, fish.gulpAnimation - dt);
    fish.gulpCountdown -= dt;
    if (fish.gulpCountdown > 0) return;

    const calmState =
      fish.state === SwimState.Hover ||
      fish.state === SwimState.Coast ||
      fish.state === SwimState.Glide;
    const chasing = this.targetActive && fish.respondedToCall;
    const eligible =
      calmState &&
      !chasing &&
      fish.depth <= FISH.feeding.eligibleDepth &&
      fish.speed <= fish.cruiseSpeed * FISH.feeding.eligibleSpeedFraction;

    if (!eligible) {
      fish.gulpCountdown = this.behaviorRange(
        fish,
        FISH.feeding.retryDelaySeconds[0],
        FISH.feeding.retryDelaySeconds[1],
      );
      return;
    }

    const forwardX = Math.cos(fish.heading);
    const forwardY = Math.sin(fish.heading);
    const mouthDistance = fish.bodyWidth * FISH.feeding.mouthForwardOffset;
    this.ripples.trigger("mouth", {
      x: fish.position.x + forwardX * mouthDistance,
      y: fish.position.y + forwardY * mouthDistance,
    });
    fish.gulpAnimation = FISH.feeding.animationDurationSeconds;
    fish.gulpCountdown = this.behaviorRange(
      fish,
      FISH.feeding.intervalSeconds[0],
      FISH.feeding.intervalSeconds[1],
    );
  }

  private behaviorUnit(fish: Koi): number {
    let value = fish.behaviorRng >>> 0;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    fish.behaviorRng = value >>> 0;
    return (fish.behaviorRng & 0x00ffffff) / 0x01000000;
  }

  private behaviorRange(fish: Koi, low: number, high: number): number {
    return low + (high - low) * this.behaviorUnit(fish);
  }

  private enterState(fish: Koi, next: SwimState): void {
    fish.state = next;
    fish.stateAge = 0;
    switch (next) {
      case SwimState.Glide:
        fish.stateDuration = this.behaviorRange(fish, 8, 18);
        break;
      case SwimState.Coast:
        fish.stateDuration = this.behaviorRange(fish, 2, 4);
        break;
      case SwimState.Hover:
        fish.stateDuration = this.behaviorRange(fish, 0.6, 1.2);
        break;
      case SwimState.Burst:
        fish.stateDuration = this.behaviorRange(fish, 0.5, 0.9);
        break;
      case SwimState.Pivot: {
        fish.stateDuration = this.behaviorRange(fish, 2, 3.5);
        const direction = this.behaviorUnit(fish) < 0.5 ? -1 : 1;
        fish.pivotHeading = wrapAngle(
          fish.heading + direction * this.behaviorRange(fish, 0.4, 0.85),
        );
        break;
      }
    }
  }

  private updateNaturalState(fish: Koi, dt: number): void {
    fish.stateAge += dt;
    if (fish.stateAge < fish.stateDuration) return;

    const roll = this.behaviorUnit(fish);
    switch (fish.state) {
      case SwimState.Glide:
        if (roll < 0.7) this.enterState(fish, SwimState.Coast);
        else if (roll < 0.94) this.enterState(fish, SwimState.Pivot);
        else this.enterState(fish, SwimState.Hover);
        break;
      case SwimState.Coast:
        this.enterState(fish, SwimState.Glide);
        break;
      case SwimState.Hover:
        this.enterState(fish, SwimState.Glide);
        break;
      case SwimState.Burst:
        this.enterState(fish, SwimState.Glide);
        break;
      case SwimState.Pivot:
        this.enterState(fish, SwimState.Glide);
        break;
    }
  }

  private steeringFor(index: number, time: number): Vec2 {
    const fish = this.fish[index];
    const forward = fromAngle(fish.heading);
    let steering = mul(forward, 0.95);

    if (fish.state === SwimState.Pivot) {
      steering = add(
        mul(forward, 0.75),
        mul(fromAngle(fish.pivotHeading), 1.15),
      );
    } else if (fish.state !== SwimState.Hover) {
      const wander =
        Math.sin(time * 0.29 + fish.wanderSeed) * 0.7 +
        Math.sin(time * 0.113 + fish.wanderSeed * 1.73) * 0.45;
      steering = add(steering, mul(fromAngle(fish.heading + wander), 0.62));
    }

    let separation = vec();
    let alignment = vec();
    let cohesion = vec();
    let neighbours = 0;

    for (let other = 0; other < this.count; other += 1) {
      if (other === index) continue;
      const offset = sub(fish.position, this.fish[other].position);
      const distance = length(offset);
      if (distance > 0.001 && distance < 37) {
        neighbours += 1;
        cohesion = add(cohesion, this.fish[other].position);
        alignment = add(alignment, normalize(this.fish[other].velocity));
        if (distance < 14) {
          separation = add(
            separation,
            mul(normalize(offset), (14 - distance) / 14),
          );
        }
      }
    }

    if (neighbours > 0) {
      cohesion = normalize(
        sub(mul(cohesion, 1 / neighbours), fish.position),
        forward,
      );
      alignment = normalize(alignment, forward);
      steering = add(steering, mul(cohesion, 0.25));
      steering = add(steering, mul(alignment, 0.42));
      steering = add(steering, mul(separation, 2.8));
    }

    for (const region of this.avoidanceRegions) {
      const away = sub(fish.position, region);
      const distance = length(away);
      const influence = region.radius + fish.bodyLength * 1.25;
      if (distance < influence) {
        const amount = (1 - distance / influence) * region.strength;
        steering = add(
          steering,
          mul(normalize(away, perpendicular(forward)), amount * 9),
        );
      }
    }

    if (this.containToWater) {
      const radius = Math.min(
        fish.bodyLength * 1.45,
        Math.min(CANVAS_WIDTH, CANVAS_HEIGHT) * 0.24,
      );
      const ahead = add(
        fish.position,
        mul(forward, radius * 1.75 + fish.speed * 0.65),
      );
      const boundary = waterClearance(ahead, CANVAS_WIDTH, CANVAS_HEIGHT);
      const margin = fishWaterMargin(fish);
      const urgency = clamp(
        (margin + fish.bodyLength * 0.45 - boundary.distance) /
          (fish.bodyLength * 1.1),
        0,
        1,
      );
      if (urgency > 0.025) {
        if (!fish.bankTurnSign) {
          const cross =
            forward.x * boundary.normal.y - forward.y * boundary.normal.x;
          fish.bankTurnSign =
            Math.abs(cross) > 0.08
              ? Math.sign(cross)
              : fish.behaviorRng & 1
                ? 1
                : -1;
        }
        // Steer along the bank as well as away from it. A pure backwards
        // normal is ambiguous at 180 degrees and can alternate turn direction.
        const tangent = mul(perpendicular(boundary.normal), -fish.bankTurnSign);
        const bankDirection = add(mul(boundary.normal, 0.62), mul(tangent, 1));
        steering = add(steering, mul(bankDirection, urgency * 6.5));
      } else fish.bankTurnSign = 0;
    } else {
      // Anticipate the bank with the full body length. Turning before contact
      // avoids positional clamps, which fold a path-following fish into a knot.
      const marginX = CANVAS_WIDTH * 0.2,
        marginY = CANVAS_HEIGHT * 0.24;
      const ahead = add(
        fish.position,
        mul(forward, fish.bodyLength * 0.9 + fish.speed * 0.7),
      );
      const edgeForce = vec();
      if (ahead.x < marginX)
        edgeForce.x = Math.min(1, (marginX - ahead.x) / (CANVAS_WIDTH * 0.11));
      if (ahead.x > CANVAS_WIDTH - marginX)
        edgeForce.x = -Math.min(
          1,
          (ahead.x - (CANVAS_WIDTH - marginX)) / (CANVAS_WIDTH * 0.11),
        );
      if (ahead.y < marginY)
        edgeForce.y = Math.min(1, (marginY - ahead.y) / (CANVAS_HEIGHT * 0.14));
      if (ahead.y > CANVAS_HEIGHT - marginY)
        edgeForce.y = -Math.min(
          1,
          (ahead.y - (CANVAS_HEIGHT - marginY)) / (CANVAS_HEIGHT * 0.14),
        );
      steering = add(steering, mul(edgeForce, 5.6));
    }

    if (this.targetActive && fish.callDelay <= 0) {
      const toTarget = sub(this.target, fish.position);
      const distance = length(toTarget);
      if (distance > 13) {
        const chasePull =
          fish.callResponseAge < FISH.callResponse.chaseBoostSeconds
            ? 3.35
            : 2.45;
        steering = add(steering, mul(normalize(toTarget), chasePull));
      } else {
        const targetDirection = normalize(toTarget, forward);
        steering = add(steering, mul(perpendicular(targetDirection), 2.2));
        steering = add(steering, mul(targetDirection, -0.5));
      }
    }

    return normalize(steering, forward);
  }

  private desiredSpeedFor(index: number): number {
    const fish = this.fish[index];
    const chaseDuration = FISH.callResponse.chaseBoostSeconds;
    const chasing =
      this.targetActive &&
      fish.respondedToCall &&
      fish.callResponseAge < chaseDuration;
    if (chasing) {
      const chaseFade = 1 - clamp(fish.callResponseAge / chaseDuration, 0, 1);
      return (
        fish.maximumSpeed *
        (FISH.callResponse.chaseSpeedMultiplier +
          chaseFade * FISH.callResponse.initialExtraSpeedMultiplier)
      );
    }

    let intention = fish.cruiseSpeed;
    for (const region of this.avoidanceRegions) {
      const distance = Math.hypot(
        fish.position.x - region.x,
        fish.position.y - region.y,
      );
      if (distance < region.radius + fish.bodyLength) {
        intention = Math.max(
          intention,
          fish.maximumSpeed * 0.9 * region.strength,
        );
      }
    }
    if (this.targetActive && fish.callDelay <= 0) {
      const distance = length(sub(this.target, fish.position));
      const urgency = clamp(distance / 105, 0.2, 1);
      intention =
        fish.cruiseSpeed + (fish.maximumSpeed - fish.cruiseSpeed) * urgency;
    }

    switch (fish.state) {
      case SwimState.Glide:
        return intention;
      case SwimState.Coast:
        return intention * 0.72;
      case SwimState.Hover:
        return intention * 0.38;
      case SwimState.Burst:
        return fish.maximumSpeed * 1.08;
      case SwimState.Pivot:
        return intention * 0.82;
    }
  }

  private integrate(
    fish: Koi,
    desired: Vec2,
    desiredSpeed: number,
    dt: number,
  ): void {
    const desiredHeading = Math.atan2(desired.y, desired.x);
    const headingError = wrapAngle(desiredHeading - fish.heading);
    // Turn radius grows with body length and contracts mildly during escape.
    // A low-speed fish cannot spin around its nose like a flat cutout.
    const escaping = this.avoidanceRegions.some(
      (region) =>
        Math.hypot(fish.position.x - region.x, fish.position.y - region.y) <
        region.radius + fish.bodyLength,
    );
    const radius = Math.max(
      25,
      Math.min(
        fish.bodyLength * (escaping ? 1.0 : 1.45),
        Math.min(CANVAS_WIDTH, CANVAS_HEIGHT) * 0.24,
      ),
    );
    const maximumTurnRate = Math.max(0.045, Math.min(0.9, fish.speed / radius));
    const desiredYaw = clamp(
      headingError * 1.35,
      -maximumTurnRate,
      maximumTurnRate,
    );
    fish.angularVelocity +=
      (desiredYaw - fish.angularVelocity) * (1 - Math.exp(-3.0 * dt));
    fish.angularVelocity = clamp(
      fish.angularVelocity,
      -maximumTurnRate,
      maximumTurnRate,
    );
    fish.heading = wrapAngle(fish.heading + fish.angularVelocity * dt);

    let speedResponse = 1.65;
    let desiredTailEffort = 0.62;
    switch (fish.state) {
      case SwimState.Glide:
        break;
      case SwimState.Coast:
        speedResponse = 1.05;
        desiredTailEffort = 0.28;
        break;
      case SwimState.Hover:
        speedResponse = 3.6;
        desiredTailEffort = 0.18;
        break;
      case SwimState.Burst:
        speedResponse = 6.4;
        desiredTailEffort = 1.22;
        break;
      case SwimState.Pivot:
        speedResponse = 4.2;
        desiredTailEffort = 0.58;
        break;
    }

    fish.speed +=
      (desiredSpeed - fish.speed) * (1 - Math.exp(-speedResponse * dt));
    fish.tailEffort +=
      (desiredTailEffort - fish.tailEffort) * (1 - Math.exp(-4.5 * dt));
    fish.velocity = mul(fromAngle(fish.heading), fish.speed);
    const candidate = add(fish.position, mul(fish.velocity, dt));
    if (this.containToWater) {
      const constrained = projectIntoWater(
        candidate,
        fishWaterMargin(fish),
        CANVAS_WIDTH,
        CANVAS_HEIGHT,
      );
      if (
        Math.hypot(constrained.x - candidate.x, constrained.y - candidate.y) >
        0.0001
      )
        this.boundaryCorrections++;
      fish.position = constrained;
    } else fish.position = candidate;

    // Phase is measured in radians. At normal cruise the tail beats about once
    // per second; stroke effort and frequency rise with actual forward speed.
    const speedFraction = clamp(
      fish.speed / Math.max(1, fish.maximumSpeed),
      0,
      1.3,
    );
    const beatHz = 0.42 + speedFraction * 0.92 + fish.tailEffort * 0.12;
    fish.swimPhase += Math.PI * 2 * beatHz * dt;
    advanceTrail(fish);
  }
}
