import * as THREE from "three";
import { LM, type Handedness, type Point } from "./types";

/**
 * Drives the Blender robot hand (public/models/robot-hand.glb, see docs/BLENDER.md) from the 21 tracked
 * joints, the same settled pose the physics colliders use.
 *
 * 1. Palm frame: +Y wrist → middle knuckle, +X toward the little finger, +Z = back of the hand. The model's
 *    rest pose has the same frame, so the wrist bone keeps its rest offset from it.
 * 2. Every other bone, palm outwards, starts from its parent's current orientation (plus its rest offset
 *    from the parent) and swings, by the smallest rotation, to point at its child joint. No bone gets a
 *    twist of its own, so fingers can't spin about their length; roll comes down from the palm.
 * 3. Each bone sits on its tracked joint and stretches along its length to the tracked bone length (the
 *    rigid skeleton's, so constant per person); thickness follows the hand scale.
 * 4. The bones are flattened (all children of one root) so a stretched bone doesn't shear its children.
 *    Skinning only needs world matrices.
 * 5. A left hand is solved as a mirrored right hand and drawn under a root mirrored in x.
 */

/** MediaPipe landmark names in index order: the model's bone names. */
export const LANDMARK_BONES = [
  "WRIST",
  ...["CMC", "MCP", "IP", "TIP"].map((j) => `THUMB_${j}`),
  ...["INDEX_FINGER", "MIDDLE_FINGER", "RING_FINGER", "PINKY"].flatMap((f) => ["MCP", "PIP", "DIP", "TIP"].map((j) => `${f}_${j}`)),
];

/** Bone → [parent bone, child joint that it points at]. Parents come first. TIPs point along their parent. */
const CHAINS = [
  [LM.THUMB_CMC, LM.THUMB_MCP, LM.THUMB_IP, LM.THUMB_TIP],
  [LM.INDEX_MCP, LM.INDEX_PIP, LM.INDEX_DIP, LM.INDEX_TIP],
  [LM.MIDDLE_MCP, LM.MIDDLE_PIP, LM.MIDDLE_DIP, LM.MIDDLE_TIP],
  [LM.RING_MCP, LM.RING_PIP, LM.RING_DIP, LM.RING_TIP],
  [LM.PINKY_MCP, LM.PINKY_PIP, LM.PINKY_DIP, LM.PINKY_TIP],
];

interface Rest {
  bone: THREE.Bone;
  /** Rest orientation relative to the parent's (the palm frame for WRIST and finger roots). */
  rel: THREE.Quaternion;
  /** Rest length: head to the joint it points at. */
  length: number;
}

const Y = new THREE.Vector3(0, 1, 0);
const qa = new THREE.Quaternion();
const va = new THREE.Vector3();
const vb = new THREE.Vector3();
const vc = new THREE.Vector3();
const m4 = new THREE.Matrix4();

/** Palm frame from joints: +Y to the middle knuckle, +X toward the pinky, +Z out of the back of the hand. */
function palmFrame(wrist: THREE.Vector3, middle: THREE.Vector3, index: THREE.Vector3, pinky: THREE.Vector3, out: THREE.Quaternion) {
  const y = va.subVectors(middle, wrist).normalize();
  const x = vb.subVectors(pinky, index);
  x.addScaledVector(y, -x.dot(y)).normalize();
  const z = vc.crossVectors(x, y);
  return out.setFromRotationMatrix(m4.makeBasis(x, y, z));
}

export class HandRig {
  /** Add this to the scene: it holds the meshes and the (flattened) bones. */
  readonly root = new THREE.Group();
  private rest = new Map<string, Rest>();
  private forearmRest: Rest;
  private joints = Array.from({ length: 21 }, () => new THREE.Vector3());
  private q = new Map<number, THREE.Quaternion>();
  private palmQ = new THREE.Quaternion();

  /** `model`: a clone of the loaded robot-hand scene (SkeletonUtils.clone), at its rest pose. */
  constructor(model: THREE.Object3D) {
    model.updateMatrixWorld(true);
    const bone = (name: string) => {
      const b = model.getObjectByName(name);
      if (!(b instanceof THREE.Bone)) throw new Error(`robot hand has no bone ${name}`);
      return b;
    };
    const pos = (name: string) => bone(name).getWorldPosition(new THREE.Vector3());
    const quat = (name: string) => bone(name).getWorldQuaternion(new THREE.Quaternion());

    const restJoints = LANDMARK_BONES.map(pos);
    const restPalm = palmFrame(restJoints[LM.WRIST], restJoints[LM.MIDDLE_MCP], restJoints[LM.INDEX_MCP], restJoints[LM.PINKY_MCP], new THREE.Quaternion());
    const relTo = (parentQ: THREE.Quaternion, name: string) => parentQ.clone().invert().multiply(quat(name));
    this.rest.set("WRIST", { bone: bone("WRIST"), rel: relTo(restPalm, "WRIST"), length: restJoints[LM.WRIST].distanceTo(restJoints[LM.MIDDLE_MCP]) });
    for (const chain of CHAINS)
      chain.forEach((j, k) => {
        const name = LANDMARK_BONES[j];
        const parentQ = k === 0 ? restPalm : quat(LANDMARK_BONES[chain[k - 1]]);
        const next = chain[k + 1];
        // TIPs are short nubs: they just ride on the distal phalanx
        const length = next === undefined ? 1 : restJoints[j].distanceTo(restJoints[next]);
        this.rest.set(name, { bone: bone(name), rel: relTo(parentQ, name), length });
      });
    this.forearmRest = { bone: bone("FOREARM"), rel: new THREE.Quaternion(), length: pos("FOREARM").distanceTo(restJoints[LM.WRIST]) };

    // Flatten: every bone becomes a direct child of root (world transforms kept), the meshes too.
    const bones = [...this.rest.values(), this.forearmRest].map((r) => r.bone);
    const meshes: THREE.SkinnedMesh[] = [];
    model.traverse((o) => {
      if (o instanceof THREE.SkinnedMesh) meshes.push(o);
    });
    for (const b of bones) this.root.attach(b);
    for (const m of meshes) {
      this.root.attach(m);
      m.frustumCulled = false; // the rest-pose bounds don't follow the bones
    }
  }

  get meshes() {
    return this.root.children.filter((o): o is THREE.SkinnedMesh => o instanceof THREE.SkinnedMesh);
  }

  /**
   * Pose the hand. `joints`: the 21 joints in scene space. `forearmDir`: unit vector from the wrist toward
   * the elbow; `forearmLength`: wrist to elbow. `thickness`: the hand scale (the model is real-hand size).
   */
  update(joints: Point[], hand: Handedness, forearmDir: Point, forearmLength: number, thickness: number) {
    // a left hand is solved as its mirror image, a right hand, and drawn mirrored back
    const mirror = hand === "Left" ? -1 : 1;
    this.root.scale.set(mirror, 1, 1);
    const J = this.joints;
    joints.forEach((p, i) => J[i].set(p.x * mirror, p.y, p.z));

    palmFrame(J[LM.WRIST], J[LM.MIDDLE_MCP], J[LM.INDEX_MCP], J[LM.PINKY_MCP], this.palmQ);
    this.place(LM.WRIST, J[LM.WRIST], J[LM.MIDDLE_MCP], this.palmQ, thickness);

    for (const chain of CHAINS) {
      chain.forEach((j, k) => {
        const parentQ = k === 0 ? this.palmQ : this.quat(chain[k - 1]);
        const next = chain[k + 1];
        if (next !== undefined) {
          this.place(j, J[j], J[next], parentQ, thickness);
          return;
        }
        // TIP nub: no child to point at; keeps the distal phalanx's turn
        const r = this.rest.get(LANDMARK_BONES[j])!;
        const q = this.quat(j).multiplyQuaternions(parentQ, r.rel);
        r.bone.position.copy(J[j]);
        r.bone.quaternion.copy(q);
        r.bone.scale.setScalar(thickness);
      });
    }

    // forearm: from the elbow to the wrist, stretched to reach the elbow
    const f = this.forearmRest;
    const elbow = vc.set(J[LM.WRIST].x + forearmDir.x * mirror * forearmLength, J[LM.WRIST].y + forearmDir.y * forearmLength, J[LM.WRIST].z + forearmDir.z * forearmLength);
    const dir = va.subVectors(J[LM.WRIST], elbow).normalize();
    f.bone.position.copy(elbow);
    // the palm's orientation swung to lie along the forearm, so the arm's back faces the hand's back
    f.bone.quaternion.setFromUnitVectors(vb.copy(Y).applyQuaternion(this.palmQ), dir).multiply(this.palmQ);
    f.bone.scale.set(thickness, forearmLength / f.length, thickness);

    this.root.updateMatrixWorld(true);
  }

  /** This frame's world orientation of landmark bone `j` (reused between frames). */
  private quat(j: number) {
    let q = this.q.get(j);
    if (!q) this.q.set(j, (q = new THREE.Quaternion()));
    return q;
  }

  /** Orient landmark bone `j` at `head` to point at `tail`, from `parentQ` · rest offset; stretch it to fit. */
  private place(j: number, head: THREE.Vector3, tail: THREE.Vector3, parentQ: THREE.Quaternion, thickness: number) {
    const r = this.rest.get(LANDMARK_BONES[j])!;
    const q = this.quat(j).multiplyQuaternions(parentQ, r.rel);
    const along = va.copy(Y).applyQuaternion(q);
    const want = vb.subVectors(tail, head);
    const length = want.length();
    if (length > 1e-6) q.premultiply(qa.setFromUnitVectors(along, want.divideScalar(length)));
    r.bone.position.copy(head);
    r.bone.quaternion.copy(q);
    r.bone.scale.set(thickness, length > 1e-6 ? length / r.length : thickness, thickness);
  }
}
