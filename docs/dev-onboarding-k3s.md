# Tài liệu Dev — Truy cập & Sử dụng Server (k3s dev)

Hướng dẫn cho dev kết nối vào hạ tầng dev của water-platform và triển khai service.
Mọi truy cập đi **qua VPN WireGuard**, sau đó dùng `kubectl`/`helm` (hoặc SSH khi cần).

> ⚠️ Đây là môi trường **dev**, quyền của bạn là `cluster-admin` (toàn quyền). Cẩn thận với
> các namespace hạ tầng. Quyền sẽ được siết lại ở production.

---

## 1. Bản đồ hạ tầng

| Server      | Vai trò                                                   | IPv4             | VPN (WireGuard) |
| ----------- | --------------------------------------------------------- | ---------------- | --------------- |
| **tino-32** | k3s control-plane + data node, VPN hub, registry, ingress | `180.93.137.109` | `10.8.0.1`      |
| **tino-12** | k3s worker (app stateless)                                | `103.142.24.14`  | —               |

| Mạng nội bộ  | Dải            | Ghi chú                  |
| ------------ | -------------- | ------------------------ |
| VPN clients  | `10.8.0.0/24`  | mỗi dev một IP           |
| Pod CIDR     | `10.42.0.0/16` | k3s flannel              |
| Service CIDR | `10.43.0.0/16` | API server = `10.43.0.1` |

Domain ingress: `*.dichvunuoc.vn` → trỏ về `180.93.137.109`, TLS tự động (cert-manager +
Let's Encrypt `letsencrypt-prod`).

---

## 2. Hồ sơ được cấp cho mỗi dev

Phát qua kênh bảo mật (1Password/Bitwarden…), **KHÔNG commit, KHÔNG gửi public**:

| File             | Nội dung                                                      | Đặt tại máy dev                |
| ---------------- | ------------------------------------------------------------- | ------------------------------ |
| `devN.conf`      | WireGuard (dev1 → `10.8.0.3`, dev2 → `10.8.0.4`)              | import vào app WireGuard       |
| `water-dev.yaml` | kubeconfig (token cluster-admin, ns mặc định `platform-core`) | `~/.kube/water-dev.yaml`       |
| `water_dev`      | SSH private key (login user `dev`)                            | `~/.ssh/water_dev` (chmod 600) |

---

## 3. Kết nối

### 3.1. Bật WireGuard (bắt buộc đầu tiên)

- **macOS/Windows**: app _WireGuard_ → _Import tunnel from file_ → chọn `devN.conf` → **Activate**.
- **Linux**:
  ```bash
  sudo install -m600 devN.conf /etc/wireguard/water-dev.conf
  sudo wg-quick up water-dev      # tắt: sudo wg-quick down water-dev
  ```
- Kiểm tra thông VPN: `ping 10.8.0.1` phải có phản hồi.

Đây là **split-tunnel**: chỉ traffic tới `10.8.0.0/24`, `10.42.0.0/16`, `10.43.0.0/16` đi qua
VPN; internet thường vẫn đi thẳng.

### 3.2. SSH vào server (khi cần thao tác trực tiếp)

```bash
chmod 600 ~/.ssh/water_dev
ssh -i ~/.ssh/water_dev dev@180.93.137.109     # vào tino-32
```

User `dev` có `sudo` (server dev). Trên server đã đặt sẵn `~/.kube/config` → chạy `kubectl` ngay.

> Khuyến nghị: thêm SSH **public key riêng của bạn** vào `/home/dev/.ssh/authorized_keys`
> thay vì dùng chung key.

### 3.3. kubectl từ laptop (cách dùng chính)

```bash
# cài kubectl nếu chưa có (mac): brew install kubectl
mkdir -p ~/.kube && cp water-dev.yaml ~/.kube/water-dev.yaml
export KUBECONFIG=~/.kube/water-dev.yaml        # nên thêm vào ~/.zshrc

kubectl get nodes                                # thấy tino-32, tino-12 = Ready
kubectl get pods -n platform-core
```

Kubeconfig trỏ tới `https://10.43.0.1:443` (API qua VPN). `kubectl` treo → kiểm tra WireGuard
đã Active chưa. Nếu vẫn không được, dùng tạm SSH (3.2) rồi chạy `kubectl` trên server.

---

## 4. Bản đồ cluster & service đang chạy

| Namespace                       | Vai trò                                      |
| ------------------------------- | -------------------------------------------- |
| `platform-core`                 | Hạ tầng nền + **nơi deploy service của bạn** |
| `demo`                          | Thử nghiệm tự do                             |
| `registry`                      | Docker registry nội bộ                       |
| `ingress-nginx`, `cert-manager` | Ingress + TLS (đừng đụng)                    |
| `observability`                 | Monitoring/logs                              |

| Dịch vụ              | URL nội bộ (cluster)                | URL ngoài (qua ingress)                                            |
| -------------------- | ----------------------------------- | ------------------------------------------------------------------ |
| APISIX (API gateway) | `apisix.platform-core:9080`         | `https://api-dev.dichvunuoc.vn`                                    |
| Keycloak (auth)      | `keycloak.platform-core:8080`       | `https://auth-dev.dichvunuoc.vn`                                   |
| Postgres             | `postgres.platform-core:5432`       | — (port-forward)                                                   |
| MinIO (S3 / console) | `minio.platform-core:9000/9001`     | `https://minio-dev...` / `https://minio-console-dev.dichvunuoc.vn` |
| RabbitMQ             | `rabbitmq.platform-core:5672/15672` | `https://rabbitmq-dev.dichvunuoc.vn`                               |
| Registry             | `registry.registry:5000`            | `https://registry-dev.dichvunuoc.vn`                               |

> Tài khoản đăng nhập các UI (Keycloak/MinIO/RabbitMQ) lấy từ kho bí mật của team hoặc hỏi
> admin — không ghi trong tài liệu này.

---

## 5. Quy trình deploy một service

### 5.1. Build & push image lên registry nội bộ

```bash
IMG=registry-dev.dichvunuoc.vn/my-service:0.1.0
docker build -t "$IMG" .
docker push "$IMG"
```

### 5.2. Manifest (Deployment + Service + Ingress) — `my-service.yaml`

```yaml
apiVersion: apps/v1
kind: Deployment
metadata: { name: my-service, namespace: platform-core }
spec:
  replicas: 1
  selector: { matchLabels: { app: my-service } }
  template:
    metadata: { labels: { app: my-service } }
    spec:
      containers:
        - name: app
          image: registry-dev.dichvunuoc.vn/my-service:0.1.0
          ports: [{ containerPort: 8080 }]
---
apiVersion: v1
kind: Service
metadata: { name: my-service, namespace: platform-core }
spec:
  selector: { app: my-service }
  ports: [{ port: 80, targetPort: 8080 }]
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: my-service
  namespace: platform-core
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
spec:
  ingressClassName: nginx
  tls:
    - hosts: [my-service-dev.dichvunuoc.vn]
      secretName: my-service-tls
  rules:
    - host: my-service-dev.dichvunuoc.vn
      http:
        paths:
          - path: /
            pathType: Prefix
            backend: { service: { name: my-service, port: { number: 80 } } }
```

> Trỏ DNS A record `my-service-dev.dichvunuoc.vn → 180.93.137.109` thì cert-manager mới cấp TLS được.

### 5.3. Apply & theo dõi

```bash
kubectl apply -f my-service.yaml
kubectl -n platform-core rollout status deploy/my-service
kubectl -n platform-core get pods,ingress
```

Lưu trữ bền: tạo PVC với storageClass mặc định `local-path`.

### 5.4. (Tuỳ chọn) Helm

```bash
helm upgrade --install my-service ./chart -n platform-core
```

---

## 6. Lệnh hay dùng

```bash
kubectl -n platform-core get pods -w                 # realtime
kubectl -n platform-core logs -f deploy/my-service   # log
kubectl -n platform-core exec -it deploy/my-service -- sh
kubectl -n platform-core describe pod <pod>          # debug pod lỗi
kubectl -n platform-core rollout restart deploy/my-service
kubectl -n platform-core port-forward svc/postgres 5432:5432   # truy cập DB từ laptop
kubectl -n platform-core delete -f my-service.yaml
```

---

## 7. Xử lý sự cố nhanh

| Triệu chứng                    | Cách xử lý                                                                                                               |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `kubectl` treo / timeout       | WireGuard chưa Active; `ping 10.8.0.1` kiểm tra; thử lại sau khi `wg-quick up`                                           |
| `ping 10.8.0.1` không thông    | Kiểm tra tunnel đã Activate; firewall chặn UDP 51821; báo admin                                                          |
| `kubectl` lỗi TLS/cert         | Đảm bảo dùng đúng `water-dev.yaml` (server `https://10.43.0.1:443`)                                                      |
| Vẫn không gọi được API qua VPN | Fallback: `ssh -i ~/.ssh/water_dev dev@180.93.137.109` rồi chạy `kubectl` trên server; báo admin để chỉnh route/iptables |
| Pod `ImagePullBackOff`         | Sai tên image hoặc chưa `docker push`; kiểm tra `registry-dev.dichvunuoc.vn/...`                                         |
| Ingress không lên HTTPS        | DNS chưa trỏ về `180.93.137.109`; xem `kubectl describe ingress`, `kubectl get certificate -n platform-core`             |

---

## 8. An toàn (bắt buộc tuân thủ)

- KHÔNG commit `devN.conf`, `water-dev.yaml`, SSH key vào git.
- Bí mật ứng dụng → `kubectl create secret`, không hardcode trong image/manifest.
- Mỗi dev nên dùng SSH public key riêng (append vào `/home/dev/.ssh/authorized_keys`).
- Liên hệ admin để được cấp/thu hồi quyền. Thu hồi quyền k8s:
  `kubectl delete clusterrolebinding dev-cluster-admin` +
  `kubectl -n kube-system delete sa dev secret dev-token`.
