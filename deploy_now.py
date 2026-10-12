import paramiko
import os
import io
import tarfile
import time

HOST = "192.168.31.180"
PORT = 22
USER = "root"
PASS = "Hik297360+"
REMOTE_DIR = "/root/kids-learning-system"

LOCAL_DIR = os.path.dirname(os.path.abspath(__file__))

# 本次需要同步的文件（含登录界面、Pansou/PanCheck 适配、流媒体代理修复）
# ⚠️ 严禁把 data/db.json 放进本列表：它属于运行时数据，
#    用户扫码得到的网盘 Cookie、转存任务、目录与用户数据都写在这里，
#    上传会直接覆盖掉线上真实凭据。种子数据请改用 server/seed 或管理端接口。
FILES = [
    "server/database.js",
    "server/routes/pan.js",
    "server/routes/resources.js",
    "server/routes/categories.js",
    "server/services/panSearchService.js",
    "server/services/panCheckService.js",
    "server/services/panAccountService.js",
    "server/services/panTransferService.js",
    "server/services/panFileService.js",
    "server/services/accelerateStreamService.js",
    "server/routes/stream.js",
    "public/admin/index.html",
    "public/admin/admin.js",
    "public/kids/index.html",
    "public/kids/kids.js",
]

print("=" * 60)
print("步骤 1/5: 连接服务器")
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, port=PORT, username=USER, password=PASS, timeout=20)
print("[OK] SSH 已连接", HOST)


def run(cmd, desc, timeout=600):
    print("\n" + "=" * 60)
    print(">>>", desc)
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode('utf-8', errors='ignore').strip()
    err = stderr.read().decode('utf-8', errors='ignore').strip()
    code = stdout.channel.recv_exit_status()
    if out:
        print(out[-3000:])
    if err:
        print("[stderr]", err[-1500:])
    print("[exit code]", code)
    return code, out, err


print("\n" + "=" * 60)
print("步骤 2/5: 打包本地更新文件")
buf = io.BytesIO()
with tarfile.open(fileobj=buf, mode='w:gz') as tar:
    for f in FILES:
        full = os.path.join(LOCAL_DIR, f)
        if os.path.exists(full):
            tar.add(full, arcname=f)
            print("  +", f)
        else:
            print("  ! 缺失:", f)
buf.seek(0)
pkg_size = len(buf.getvalue())
print(f"[OK] 打包完成，共 {pkg_size} 字节")

print("\n" + "=" * 60)
print("步骤 3/5: 上传更新包")
sftp = ssh.open_sftp()
remote_pkg = f"{REMOTE_DIR}/deploy_update.tar.gz"
sftp.putfo(buf, remote_pkg)
sftp.close()
print("[OK] 已上传至", remote_pkg)

print("\n" + "=" * 60)
print("步骤 4/5: 备份线上运行时数据 → 解压 → 重新构建镜像")
# 部署前先备份线上运行时数据（网盘 Cookie / 用户 / 转存任务都在这里），避免任何意外覆盖
run(f"cd {REMOTE_DIR} && mkdir -p data/backups && "
    f"cp -a data/db.json data/backups/db.json.$(date +%Y%m%d_%H%M%S) 2>/dev/null; "
    f"ls -la data/backups/ | tail -5",
    "备份线上 data/db.json")
run(f"cd {REMOTE_DIR} && tar -xzf deploy_update.tar.gz && rm -f deploy_update.tar.gz && ls -la server/services/",
    "解压更新文件")
run(f"cd {REMOTE_DIR} && docker compose build --no-cache", "docker compose build (重新构建)", timeout=900)

print("\n" + "=" * 60)
print("步骤 5/5: 重启容器并验证")
run(f"cd {REMOTE_DIR} && docker compose up -d", "启动容器")
time.sleep(6)
run("docker ps --filter name=kids-learning-app --format '{{.Names}} | {{.Status}} | {{.Ports}}'", "容器状态")
run("curl -s -m 10 -o /dev/null -w 'HTTP %{http_code}' http://localhost:3001/api/health", "健康检查")
run("curl -s -m 10 http://localhost:3001/admin/ | grep -c adminLoginModal", "admin 登录弹窗存在性")
run("curl -s -m 10 http://localhost:3001/kids/ | grep -c kidLoginModal", "kids 登录弹窗存在性")
# 确认线上网盘授权数据未被覆盖
run("docker exec kids-learning-app node -e \""
    "const d=require('/app/data/db.json');"
    "const q=(d.panAccounts||[]).find(p=>p.panType==='quark')||{};"
    "console.log('夸克 Cookie 长度:', String(q.cookies||'').length, '| 状态:', q.status, '| 更新于:', q.updatedAt);"
    "console.log('用户数:', (d.users||[]).length, '| 分类数:', (d.categories||[]).length, '| 资源数:', (d.resources||[]).length);\"",
    "运行时数据完整性检查")

ssh.close()
print("\n" + "=" * 60)
print("[DONE] 部署完成")
