import * as THREE from 'three';

// 入力状態のインターフェース
interface FlightInputs {
    throttle: number;   // 推力 (0 ~ 1)
    pitch: number;      // エレベーター (-1 ~ 1)
    roll: number;       // エルロン (-1 ~ 1)
    yaw: number;        // ラダー (-1 ~ 1)
    nacelAngle: number; // ナセル角度 (0: 固定翼モード, Math.PI/2: ヘリモード)
}

export class V22Simulator {
    private scene!: THREE.Scene;
    private camera!: THREE.PerspectiveCamera;
    private renderer!: THREE.WebGLRenderer;
    
    // 機体オブジェクト
    private aircraft!: THREE.Group;
    private leftNacelle!: THREE.Mesh;
    private rightNacelle!: THREE.Mesh;
    private leftProprotor!: THREE.Mesh;
    private rightProprotor!: THREE.Mesh;

    // 物理パラメータ
    private velocity = new THREE.Vector3();
    private angularVelocity = new THREE.Vector3();
    private inputs: FlightInputs = { throttle: 0.5, pitch: 0, roll: 0, yaw: 0, nacelAngle: Math.PI / 2 };

    constructor(containerId: string) {
        this.initScene(containerId);
        this.createAircraft();
        this.setupInputs();
        this.animate();
    }

    // 1. シーンと画面の初期化
    private initScene(containerId: string): void {
        const container = document.getElementById(containerId);
        if (!container) throw new Error("Container element not found");

        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x87ceeb); // 青空

        this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.camera.position.set(0, 5, -15);

        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        container.appendChild(this.renderer.domElement);

        // 環境光と平行光源
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
        this.scene.add(ambientLight);
        const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
        dirLight.position.set(5, 10, 7);
        this.scene.add(dirLight);

        // 地面
        const grid = new THREE.GridHelper(1000, 100, 0x000000, 0x444444);
        grid.position.y = -10;
        this.scene.add(grid);
    }

    // 2. V-22の簡易3Dモデル生成
    private createAircraft(): void {
        this.aircraft = new THREE.Group();

        // 胴体 (Fuselage)
        const bodyGeo = new THREE.BoxGeometry(1.5, 1.5, 6);
        const bodyMat = new THREE.MeshStandardMaterial({ color: 0x708090 });
        const fuselage = new THREE.Mesh(bodyGeo, bodyMat);
        this.aircraft.add(fuselage);

        // 主翼 (Main Wing)
        const wingGeo = new THREE.BoxGeometry(8, 0.2, 1.5);
        const wing = new THREE.Mesh(wingGeo, bodyMat);
        wing.position.set(0, 0.75, 0);
        this.aircraft.add(wing);

        // 左ナセル (ローターマウント)
        const nacelleGeo = new THREE.CylinderGeometry(0.4, 0.4, 1.5, 16);
        nacelleGeo.rotateX(Math.PI / 2); // 基準を前方向にする
        const nacelleMat = new THREE.MeshStandardMaterial({ color: 0x555555 });
        
        this.leftNacelle = new THREE.Mesh(nacelleGeo, nacelleMat);
        this.leftNacelle.position.set(-4, 0.75, 0);
        this.aircraft.add(this.leftNacelle);

        // 右ナセル
        this.rightNacelle = this.leftNacelle.clone();
        this.rightNacelle.position.set(4, 0.75, 0);
        this.aircraft.add(this.rightNacelle);

        // プロップローター (簡易的な十字)
        const rotorGeo = new THREE.BoxGeometry(3, 0.1, 0.1);
        const rotorMat = new THREE.MeshBasicMaterial({ color: 0x111111 });
        
        this.leftProprotor = new THREE.Mesh(rotorGeo, rotorMat);
        this.leftProprotor.position.set(0, 0, 0.8); // ナセルの前方
        this.leftNacelle.add(this.leftProprotor);

        this.rightProprotor = this.leftProprotor.clone();
        this.rightNacelle.add(this.rightProprotor);

        this.aircraft.position.y = 0;
        this.scene.add(this.aircraft);
    }

    // 3. キーボード入力制御
    private setupInputs(): void {
        window.addEventListener('keydown', (e) => {
            switch(e.key.toLowerCase()) {
                case 'w': this.inputs.pitch = -1; break; // 機首下げ
                case 's': this.inputs.pitch = 1; break;  // 機首上げ
                case 'a': this.inputs.roll = -1; break;  // 左ロール
                case 'd': this.inputs.roll = 1; break;   // 右ロール
                case 'q': this.inputs.yaw = -1; break;    // 左ヨー
                case 'e': this.inputs.yaw = 1; break;     // 右ヨー
                case 'shift': this.inputs.throttle = Math.min(this.inputs.throttle + 0.05, 1); break; // 出力アップ
                case 'control': this.inputs.throttle = Math.max(this.inputs.throttle - 0.05, 0); break; // 出力ダウン
                // ナセル角度操作 (F: 固定翼モードへ変換, V: ヘリモードへ変換)
                case 'f': this.inputs.nacelAngle = Math.max(this.inputs.nacelAngle - 0.05, 0); break;
                case 'v': this.inputs.nacelAngle = Math.min(this.inputs.nacelAngle + 0.05, Math.PI / 2); break;
            }
        });

        window.addEventListener('keyup', (e) => {
            if (['w', 's'].includes(e.key.toLowerCase())) this.inputs.pitch = 0;
            if (['a', 'd'].includes(e.key.toLowerCase())) this.inputs.roll = 0;
            if (['q', 'e'].includes(e.key.toLowerCase())) this.inputs.yaw = 0;
        });
    }

    // 4. フライトダイナミクス（物理演算）の更新
    private updatePhysics(delta: number): void {
        // ナセルの回転度合いを適用 (0 = 真前/固定翼, PI/2 = 真上/ヘリ)
        this.leftNacelle.rotation.x = -this.inputs.nacelAngle;
        this.rightNacelle.rotation.x = -this.inputs.nacelAngle;

        // ローターの高速回転（視覚効果）
        const rotorSpeed = this.inputs.throttle * 0.5;
        this.leftProprotor.rotation.z += rotorSpeed;
        this.rightProprotor.rotation.z -= rotorSpeed; // 逆回転

        // --- 簡易エアロダイナミクスロジック ---
        // 総推力
        const maxThrust = 25;
        const totalThrust = this.inputs.throttle * maxThrust;

        // ナセル角度に応じて推力を分解
        // ヘリモード(PI/2) = 垂直推力、固定翼モード(0) = 前進推力
        const localThrust = new THREE.Vector3(
            0,
            totalThrust * Math.sin(this.inputs.nacelAngle), // 垂直成分
            totalThrust * Math.cos(this.inputs.nacelAngle)  // 前進成分
        );

        // 世界座標系への変換
        const worldThrust = localThrust.clone().applyQuaternion(this.aircraft.quaternion);
        
        // 重力
        const gravity = new THREE.Vector3(0, -9.81, 0);
        
        // 揚力 (固定翼モード時の速度に応じた簡易揚力)
        const forwardSpeed = Math.max(0, this.velocity.dot(new THREE.Vector3(0, 0, 1).applyQuaternion(this.aircraft.quaternion)));
        const liftMagnitude = forwardSpeed * 1.5 * Math.cos(this.inputs.nacelAngle); // ナセルが寝ているほど揚力が発生
        const lift = new THREE.Vector3(0, liftMagnitude, 0).applyQuaternion(this.aircraft.quaternion);

        // 加速度の計算 (簡易的に質量=1とする)
        const acceleration = new THREE.Vector3()
            .add(worldThrust)
            .add(gravity)
            .add(lift)
            .addScaledVector(this.velocity, -0.1); // 空気抵抗

        // 速度と位置の更新
        this.velocity.addScaledVector(acceleration, delta);
        this.aircraft.position.addScaledVector(this.velocity, delta);

        // 回転の更新（ピッチ、ロール、ヨー）
        this.aircraft.rotateX(this.inputs.pitch * delta * 1.5);
        this.aircraft.rotateY(-this.inputs.yaw * delta * 1.0);
        this.aircraft.rotateZ(-this.inputs.roll * delta * 1.5);

        // 地面衝突判定
        if (this.aircraft.position.y < -8.5) {
            this.aircraft.position.y = -8.5;
            this.velocity.set(0, 0, 0);
        }

        // カメラを機体の後方に追従
        const offset = new THREE.Vector3(0, 3, -12).applyQuaternion(this.aircraft.quaternion);
        this.camera.position.copy(this.aircraft.position).add(offset);
        this.camera.lookAt(this.aircraft.position);
    }

    // 5. アニメーションループ
    private clock = new THREE.Clock();
    private animate = (): void => {
        requestAnimationFrame(this.animate);
        const delta = this.clock.getDelta();
        
        this.updatePhysics(Math.min(delta, 0.1)); // ラグ対策
        this.renderer.render(this.scene, this.camera);
    };
}