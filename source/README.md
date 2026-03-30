# FastSAM3D Evaluation Guide

## 📦 Evaluation Datasets

* **iso3d official dataset**: [Download Link](https://huggingface.co/datasets/dylanebert/iso3d/tree/main)
* **toys600**: (A subset of toy4k, used for FastSAM3D evaluation). It is a single-view sampled object dataset.
  * Contains 1000 object models and 600 single-view object jpg and png images.
  * 下载链接：（后面会传上 HuggingFace，目前在 21 号服务器中的 `/data3/wmq2/data_set_end/toys600`）

> **💡 Evaluation Data Placement Instructions**
> Please place the masked png images and mesh models in the following paths respectively:
> * `example_data/png@1024`
> * `example_data/MESH`

---

## 🗂️ Model Weights Configuration

### 1. Uni3D
You need to download two model weights: the CLIP weight (a bin file) and the Uni3D weight (a pt file). Please place them in the `uni3d` folder within the uni3d evaluation directory.
* **CLIP weight link**: [open_clip_pytorch_model.bin](https://huggingface.co/timm/eva02_enormous_patch14_plus_clip_224.laion2b_s9b_b144k/blob/main/open_clip_pytorch_model.bin)
* **Uni3D weight link**: [ModelZoo](https://huggingface.co/BAAI/Uni3D/tree/main/modelzoo)

### 2. ULIP
You need to download one ULIP model weight and place it in the `/ulip/ULIP/pre_models` folder within the uni3d evaluation directory.
* **ULIP pre-trained model link**: [ckpt_zero-shot_classification](https://huggingface.co/datasets/SFXX/ulip/tree/main/ULIP-1/pretrained_models/ckpt_zero-sho_classification)
* *Note: The default pre-trained model used for our evaluation is `checkpoint_pointbert.pt`. If you need to change the model, you must update the `ckpt_path` in `ulip_score.py`.*

---

## 🛠️ ULIP Environment Setup (Conda)

### 1. Create Conda Environment
```bash
conda create -n ulip_env python=3.7.12 -y
conda activate ulip_env
export PYTHONNOUSERSITE=1
```

### 2. Install Complete CUDA Compilation Environment
```bash
conda install -c conda-forge gxx_linux-64=7.5.0 gcc_linux-64=7.5.0 -y
pip install torch==1.12.1+cu113 torchvision==0.13.1+cu113 torchaudio==0.12.1+cu113 --extra-index-url [https://download.pytorch.org/whl/cu113](https://download.pytorch.org/whl/cu113)
```

### 3. Install Common Dependencies
```bash
pip install -r requirements.txt
```

### 4. Compile pointnet2_ops Locally
Enter the pointnet2_ops source directory:
```bash
cd pointnet2_ops-main/
```

**[ATTENTION] You must align the GPU architecture before compiling:**
Our evaluation platform is equipped with A100/A800 GPUs, which use the Ampere architecture. The corresponding compatible `TORCH_CUDA_ARCH_LIST` is `8.0`.
You can modify the `TORCH_CUDA_ARCH_LIST` version in the **current `setup.py` file**, and this version must match your hardware.
* If you are using other types of GPUs, please be aware of architecture compatibility issues (e.g., Ada Lovelace architecture corresponds to `TORCH_CUDA_ARCH_LIST=8.9`, which is incompatible with PyTorch 1.12).
* However, higher-version hardware is backward compatible. You can lower the `TORCH_CUDA_ARCH_LIST` version. For Ada Lovelace architecture, you can safely use `TORCH_CUDA_ARCH_LIST=8.0`.
* *(Compatible `TORCH_CUDA_ARCH_LIST` versions for PyTorch 1.12 are 7.0, 7.5, 8.0, 8.6)*

Compile pointnet2_ops:
```bash
pip install .
```

### 5. Persist Isolation Environment Variables
```bash
mkdir -p $CONDA_PREFIX/etc/conda/activate.d
mkdir -p $CONDA_PREFIX/etc/conda/deactivate.d
echo 'export PYTHONNOUSERSITE=1' > $CONDA_PREFIX/etc/conda/activate.d/env_vars.sh
echo 'unset PYTHONNOUSERSITE' > $CONDA_PREFIX/etc/conda/deactivate.d/env_vars.sh
```

---
**Encountered any issues?**

If you run into any problems, please submit an issue to us!