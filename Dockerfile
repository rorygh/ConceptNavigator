FROM runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1

# Core requirements
COPY requirements.txt /tmp/requirements.txt
RUN pip install uv && \
    uv pip install --system --no-cache -r /tmp/requirements.txt

# Vim keybindings in all bash sessions
RUN echo 'set -o vi' >> /root/.bashrc

# First-run setup — clone repo + bootstrap data on pod start
COPY setup.sh /setup.sh
RUN chmod +x /setup.sh

EXPOSE 8000
WORKDIR /workspace
