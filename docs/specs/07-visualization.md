# 图可视化规格

> D3.js 力导向图展示知识关系

## 数据结构

### GraphData

```typescript
interface GraphData {
  nodes: GraphNode[]
  links: GraphLink[]
  metadata: GraphMetadata
}

interface GraphNode {
  id: string              // 实体ID
  name: string            // 显示名称
  description?: string    // 描述（悬停显示）
  entityType: string      // 实体类型
  weight: number          // 节点权重（影响大小）
  group: number           // 分组（用于颜色）
  x?: number              // 位置（可选，用于固定节点）
  y?: number
}

interface GraphLink {
  source: string          // 源节点ID
  target: string          // 目标节点ID
  relationType: string    // 关系类型
  weight: number          // 边权重（影响粗细）
}

interface GraphMetadata {
  totalNodes: number
  totalLinks: number
  centerEntityId?: string
  generatedAt: string
}
```

---

## 后端 API

### 获取全图数据

```http
GET /api/graph/data?
  limit=100&              # 最大节点数
  minRelations=1          # 最少关系数（过滤孤立节点）
```

**响应**:
```json
{
  "nodes": [
    {
      "id": "550e8400-...",
      "name": "Rust语言",
      "entityType": "tool",
      "weight": 5,
      "group": 1
    }
  ],
  "links": [
    {
      "source": "550e8400-...",
      "target": "660e8400-...",
      "relationType": "part_of",
      "weight": 0.9
    }
  ],
  "metadata": {
    "totalNodes": 45,
    "totalLinks": 67,
    "generatedAt": "2024-01-15T10:30:00Z"
  }
}
```

### 获取邻域图

```http
GET /api/graph/neighbors/{entityId}?
  depth=2&                # 遍历深度
  maxNodes=50             # 最大节点数
```

### 后端实现

```python
# backend/app/api/routers/graph.py

@router.get("/data")
async def get_graph_data(
    limit: int = 100,
    min_relations: int = 1,
    user_id: str = Depends(get_current_user_id)
) -> GraphData:
    """获取知识图谱数据"""

    # 1. 获取有足够关系的实体
    entities = await supabase.rpc(
        "get_entities_with_relations",
        {"user_id": user_id, "min_relations": min_relations, "limit": limit}
    ).execute()

    # 2. 获取这些实体之间的关系
    entity_ids = [e["id"] for e in entities.data]
    relations = await supabase.from_("relates_to") \
        .select("*") \
        .in_("source_entity_id", entity_ids) \
        .in_("target_entity_id", entity_ids) \
        .eq("user_id", user_id) \
        .execute()

    # 3. 计算节点权重（基于关系数）
    relation_counts = {}
    for rel in relations.data:
        relation_counts[rel["source_entity_id"]] = relation_counts.get(rel["source_entity_id"], 0) + 1
        relation_counts[rel["target_entity_id"]] = relation_counts.get(rel["target_entity_id"], 0) + 1

    # 4. 构建图数据
    type_to_group = {"concept": 1, "person": 2, "tool": 3, "project": 4, "idea": 5}

    nodes = [
        GraphNode(
            id=e["id"],
            name=e["name"],
            description=e.get("description"),
            entityType=e["entity_type"],
            weight=relation_counts.get(e["id"], 1),
            group=type_to_group.get(e["entity_type"], 0)
        )
        for e in entities.data
    ]

    links = [
        GraphLink(
            source=r["source_entity_id"],
            target=r["target_entity_id"],
            relationType=r["relation_type"],
            weight=r.get("weight", 1.0)
        )
        for r in relations.data
    ]

    return GraphData(
        nodes=nodes,
        links=links,
        metadata=GraphMetadata(
            totalNodes=len(nodes),
            totalLinks=len(links),
            generatedAt=datetime.utcnow().isoformat()
        )
    )


@router.get("/neighbors/{entity_id}")
async def get_neighbors(
    entity_id: str,
    depth: int = 2,
    max_nodes: int = 50,
    user_id: str = Depends(get_current_user_id)
) -> GraphData:
    """获取实体的邻域图"""

    visited = {entity_id}
    all_relations = []
    current_level = [entity_id]

    for d in range(depth):
        if not current_level or len(visited) >= max_nodes:
            break

        # 获取当前层的所有关系
        relations = await supabase.from_("relates_to") \
            .select("*") \
            .or_(f"source_entity_id.in.({','.join(current_level)}),target_entity_id.in.({','.join(current_level)})") \
            .eq("user_id", user_id) \
            .execute()

        next_level = set()
        for rel in relations.data:
            all_relations.append(rel)
            for eid in [rel["source_entity_id"], rel["target_entity_id"]]:
                if eid not in visited and len(visited) < max_nodes:
                    visited.add(eid)
                    next_level.add(eid)

        current_level = list(next_level)

    # 获取所有实体详情
    entities = await supabase.from_("knowledge_entity") \
        .select("*") \
        .in_("id", list(visited)) \
        .execute()

    # 构建图数据（同上）
    # ...
```

### 数据库函数

```sql
CREATE OR REPLACE FUNCTION get_entities_with_relations(
  p_user_id uuid,
  min_relations int DEFAULT 1,
  p_limit int DEFAULT 100
)
RETURNS TABLE (
  id uuid,
  name text,
  description text,
  entity_type text,
  relation_count bigint
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    ke.id,
    ke.name,
    ke.description,
    ke.entity_type,
    COUNT(DISTINCT rt.id) as relation_count
  FROM knowledge_entity ke
  LEFT JOIN relates_to rt ON
    (rt.source_entity_id = ke.id OR rt.target_entity_id = ke.id)
    AND rt.user_id = p_user_id
  WHERE ke.user_id = p_user_id
  GROUP BY ke.id
  HAVING COUNT(DISTINCT rt.id) >= min_relations
  ORDER BY relation_count DESC
  LIMIT p_limit;
END;
$$;
```

---

## 前端组件

### 主图组件

```tsx
// frontend/components/graph/knowledge-graph.tsx

import * as d3 from 'd3'
import { useEffect, useRef, useState } from 'react'

interface KnowledgeGraphProps {
  data: GraphData
  width?: number
  height?: number
  onNodeClick?: (nodeId: string) => void
  onNodeHover?: (node: GraphNode | null) => void
  centerEntityId?: string
}

export function KnowledgeGraph({
  data,
  width = 800,
  height = 600,
  onNodeClick,
  onNodeHover,
  centerEntityId
}: KnowledgeGraphProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [transform, setTransform] = useState(d3.zoomIdentity)

  useEffect(() => {
    if (!svgRef.current || !data.nodes.length) return

    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()

    // 创建容器
    const g = svg.append('g')
      .attr('transform', transform.toString())

    // 定义箭头
    svg.append('defs').append('marker')
      .attr('id', 'arrowhead')
      .attr('viewBox', '0 -5 10 10')
      .attr('refX', 20)
      .attr('refY', 0)
      .attr('markerWidth', 6)
      .attr('markerHeight', 6)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M0,-5L10,0L0,5')
      .attr('fill', '#999')

    // 颜色映射
    const color = d3.scaleOrdinal(d3.schemeCategory10)

    // 力导向模拟
    const simulation = d3.forceSimulation(data.nodes as any)
      .force('link', d3.forceLink(data.links as any)
        .id((d: any) => d.id)
        .distance(100)
        .strength((d: any) => d.weight * 0.5))
      .force('charge', d3.forceManyBody().strength(-300))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius(30))

    // 绘制边
    const links = g.append('g')
      .selectAll('line')
      .data(data.links)
      .join('line')
      .attr('stroke', '#999')
      .attr('stroke-opacity', 0.6)
      .attr('stroke-width', (d) => Math.sqrt(d.weight) * 2)
      .attr('marker-end', 'url(#arrowhead)')

    // 绘制节点
    const nodes = g.append('g')
      .selectAll('g')
      .data(data.nodes)
      .join('g')
      .attr('class', 'node')
      .call(drag(simulation) as any)

    // 节点圆形
    nodes.append('circle')
      .attr('r', (d) => 8 + Math.sqrt(d.weight) * 3)
      .attr('fill', (d) => color(String(d.group)))
      .attr('stroke', (d) => d.id === centerEntityId ? '#ff0' : '#fff')
      .attr('stroke-width', (d) => d.id === centerEntityId ? 3 : 1.5)

    // 节点标签
    nodes.append('text')
      .text((d) => d.name)
      .attr('x', 12)
      .attr('y', 4)
      .attr('font-size', '12px')
      .attr('fill', '#333')

    // 悬停效果
    nodes
      .on('mouseover', (event, d) => {
        onNodeHover?.(d)
        d3.select(event.currentTarget).select('circle')
          .attr('stroke', '#000')
          .attr('stroke-width', 2)
      })
      .on('mouseout', (event, d) => {
        onNodeHover?.(null)
        d3.select(event.currentTarget).select('circle')
          .attr('stroke', d.id === centerEntityId ? '#ff0' : '#fff')
          .attr('stroke-width', d.id === centerEntityId ? 3 : 1.5)
      })
      .on('click', (event, d) => {
        onNodeClick?.(d.id)
      })

    // 力模拟更新
    simulation.on('tick', () => {
      links
        .attr('x1', (d: any) => d.source.x)
        .attr('y1', (d: any) => d.source.y)
        .attr('x2', (d: any) => d.target.x)
        .attr('y2', (d: any) => d.target.y)

      nodes.attr('transform', (d: any) => `translate(${d.x},${d.y})`)
    })

    // 缩放
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on('zoom', (event) => {
        g.attr('transform', event.transform)
        setTransform(event.transform)
      })

    svg.call(zoom)

    return () => {
      simulation.stop()
    }
  }, [data, width, height, centerEntityId])

  return (
    <svg
      ref={svgRef}
      width={width}
      height={height}
      className="knowledge-graph"
    />
  )
}

// 拖拽行为
function drag(simulation: d3.Simulation<any, any>) {
  function dragstarted(event: any) {
    if (!event.active) simulation.alphaTarget(0.3).restart()
    event.subject.fx = event.subject.x
    event.subject.fy = event.subject.y
  }

  function dragged(event: any) {
    event.subject.fx = event.x
    event.subject.fy = event.y
  }

  function dragended(event: any) {
    if (!event.active) simulation.alphaTarget(0)
    event.subject.fx = null
    event.subject.fy = null
  }

  return d3.drag()
    .on('start', dragstarted)
    .on('drag', dragged)
    .on('end', dragended)
}
```

### 控制面板

```tsx
// frontend/components/graph/graph-controls.tsx

interface GraphControlsProps {
  onZoomIn: () => void
  onZoomOut: () => void
  onReset: () => void
  onFilterChange: (filters: GraphFilters) => void
  entityTypes: string[]
}

export function GraphControls({
  onZoomIn,
  onZoomOut,
  onReset,
  onFilterChange,
  entityTypes
}: GraphControlsProps) {
  const [selectedTypes, setSelectedTypes] = useState<string[]>(entityTypes)
  const [minRelations, setMinRelations] = useState(1)

  return (
    <div className="graph-controls flex items-center gap-4 p-4 bg-gray-50 rounded-lg">
      {/* 缩放控制 */}
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={onZoomIn}>
          <ZoomIn className="w-4 h-4" />
        </Button>
        <Button size="sm" variant="outline" onClick={onZoomOut}>
          <ZoomOut className="w-4 h-4" />
        </Button>
        <Button size="sm" variant="outline" onClick={onReset}>
          <Maximize className="w-4 h-4" />
        </Button>
      </div>

      {/* 类型过滤 */}
      <div className="flex items-center gap-2">
        <Label>类型:</Label>
        <MultiSelect
          options={entityTypes.map(t => ({ value: t, label: t }))}
          value={selectedTypes}
          onChange={(types) => {
            setSelectedTypes(types)
            onFilterChange({ entityTypes: types, minRelations })
          }}
        />
      </div>

      {/* 关系数过滤 */}
      <div className="flex items-center gap-2">
        <Label>最少关系:</Label>
        <Slider
          min={0}
          max={10}
          value={[minRelations]}
          onValueChange={([val]) => {
            setMinRelations(val)
            onFilterChange({ entityTypes: selectedTypes, minRelations: val })
          }}
        />
        <span>{minRelations}</span>
      </div>
    </div>
  )
}
```

### 节点提示框

```tsx
// frontend/components/graph/node-tooltip.tsx

interface NodeTooltipProps {
  node: GraphNode | null
  position: { x: number; y: number }
}

export function NodeTooltip({ node, position }: NodeTooltipProps) {
  if (!node) return null

  return (
    <div
      className="absolute z-50 p-3 bg-white shadow-lg rounded-lg border max-w-xs"
      style={{
        left: position.x + 10,
        top: position.y + 10
      }}
    >
      <h4 className="font-semibold">{node.name}</h4>
      <span className="text-xs text-gray-500">{node.entityType}</span>
      {node.description && (
        <p className="text-sm text-gray-600 mt-1 line-clamp-3">
          {node.description}
        </p>
      )}
      <div className="text-xs text-gray-400 mt-2">
        {node.weight} 个关系
      </div>
    </div>
  )
}
```

---

## 页面组件

```tsx
// frontend/app/(reader)/graph/page.tsx

export default function GraphPage() {
  const [data, setData] = useState<GraphData | null>(null)
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null)
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null)
  const router = useRouter()

  useEffect(() => {
    fetchGraphData().then(setData)
  }, [])

  const handleNodeClick = (nodeId: string) => {
    setSelectedEntityId(nodeId)
    // 可选：导航到实体详情
    // router.push(`/knowledge/${nodeId}`)
  }

  const handleFilterChange = async (filters: GraphFilters) => {
    const newData = await fetchGraphData(filters)
    setData(newData)
  }

  if (!data) {
    return <LoadingSpinner />
  }

  return (
    <div className="h-full flex flex-col">
      <GraphControls
        onZoomIn={() => {}}
        onZoomOut={() => {}}
        onReset={() => {}}
        onFilterChange={handleFilterChange}
        entityTypes={['concept', 'person', 'tool', 'project', 'idea']}
      />

      <div className="flex-1 relative">
        <KnowledgeGraph
          data={data}
          width={window.innerWidth - 250}
          height={window.innerHeight - 200}
          onNodeClick={handleNodeClick}
          onNodeHover={setHoveredNode}
          centerEntityId={selectedEntityId}
        />

        <NodeTooltip
          node={hoveredNode}
          position={{ x: 0, y: 0 }}
        />
      </div>

      {/* 侧边栏：选中实体详情 */}
      {selectedEntityId && (
        <EntitySidebar
          entityId={selectedEntityId}
          onClose={() => setSelectedEntityId(null)}
        />
      )}
    </div>
  )
}
```

---

## 颜色方案

| 实体类型 | 颜色 | 说明 |
|---------|------|------|
| concept | #1f77b4 | 蓝色 - 概念/定义 |
| person | #ff7f0e | 橙色 - 人物 |
| organization | #2ca02c | 绿色 - 组织 |
| tool | #d62728 | 红色 - 工具 |
| project | #9467bd | 紫色 - 项目 |
| idea | #8c564b | 棕色 - 想法 |
| book | #e377c2 | 粉色 - 书籍 |
| event | #7f7f7f | 灰色 - 事件 |
| location | #bcbd22 | 黄绿色 - 地点 |

---

## 性能优化

1. **节点限制**: 默认最多显示100个节点
2. **懒加载**: 展开邻域时按需加载
3. **WebGL**: 大规模图可考虑使用 WebGL 渲染（如 Three.js）
4. **服务端分页**: 支持分页加载图数据

---

## 下一步

继续阅读 `08-api-endpoints.md` 了解完整的API设计。
