package authz

const ResourceContentAudit = "content_audit"

var ContentAuditRead = Permission{Resource: ResourceContentAudit, Action: ActionRead}

func init() {
	RegisterResource(ResourceDefinition{
		Resource: ResourceContentAudit,
		LabelKey: "Content Audit",
		Actions: []ActionDefinition{{
			Action:         ActionRead,
			LabelKey:       "View retained relay content",
			DescriptionKey: "View request and response content retained for compliance traceability. Grant only to administrators who need this access.",
		}},
	})
}
